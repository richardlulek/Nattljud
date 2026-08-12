/**
 * Ljudmotorn. Fristående modul (ingen React) så att den kan återanvändas i en
 * framtida Capacitor-app.
 *
 * Arkitektur enligt kravspecen:
 *  - Uppspelning sker ALLTID via vanliga <audio>-element med WAV-blobbar och
 *    loop=true. Web Audio används inte för uppspelning (suspenderas vid låst
 *    skärm på iOS).
 *  - Looparna är sömlösa per konstruktion (crossfade inbakad i filen).
 *  - Media Session ger låsskärmskontroller.
 *  - Volym/fades: element.volume där det stöds. På iPhone kan JS inte styra
 *    elementvolym – där "bakas" volymen i stället in i WAV-datat och byts via
 *    ett andra, synkroniserat <audio>-element (stegvisa fades).
 */
import { ensureSound, getReady, getSilentUrl } from "./library";
import { scaledCopy } from "./loop";
import { getSound, SR, type SoundId } from "./sounds";
import { effectiveGain, fadeMult, sliderToGain } from "./volume";
import { wavBlob } from "./wav";

export type EngineStatus = "idle" | "playing" | "paused" | "stopping";

export interface LayerConfig {
  soundId: SoundId;
  volume: number; // reglagevärde 0..1
}

export interface TimerState {
  endsAt: number; // epoch ms
  fadeOutMs: number;
  totalMin: number;
}

export interface EngineState {
  status: EngineStatus;
  layers: LayerConfig[];
  timer: TimerState | null;
  startedAt: number | null;
  bakedVolumeMode: boolean;
}

export interface StartConfig {
  layers: LayerConfig[];
  fadeInMs: number;
  maxVol: number;
  /** minuter; 0 = hela natten */
  timerMin: number;
  fadeOutMs: number;
}

interface Fade {
  from: number;
  to: number;
  startAt: number;
  durMs: number;
  onDone?: () => void;
  /** för bakat läge: nästa tidpunkt att baka om */
  nextBakeAt: number;
  stepMs: number;
}

const TICK_MS = 250;

function detectBakedMode(): boolean {
  if (typeof document === "undefined") return false;
  // iPhone/iPod ignorerar (historiskt) tilldelning av HTMLMediaElement.volume.
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  try {
    const el = document.createElement("audio");
    el.volume = 0.4;
    return Math.abs(el.volume - 0.4) > 0.01;
  } catch {
    return false;
  }
}

export class NattEngine {
  readonly bakedMode = detectBakedMode();

  private els: (HTMLAudioElement | null)[] = [null, null, null, null];
  /** vilken av A/B som är aktiv per lager (stafetten och bakat läge växlar) */
  private activeSide: (0 | 1)[] = [0, 0];
  private bakedUrls: (string | null)[] = [null, null, null, null];
  private bakeBusy = [false, false];
  private lastBakedGain = [1, 1];
  /** stafett: är partnern laddad och redo att ta över vid loopgränsen? */
  private prepped = [false, false];
  /** stafett: har partnern startats i skarvfönstret? */
  private handing = [false, false];
  /** senaste currentTime per slot – för att upptäcka wrap */
  private lastCt = [0, 0, 0, 0];

  private status: EngineStatus = "idle";
  private layers: LayerConfig[] = [];
  private maxVol = 1;
  private boost = 1;
  private timer: TimerState | null = null;
  private startedAt: number | null = null;

  private m = 1; // aktuell fade-multiplikator (0..1)
  private fade: Fade | null = null;
  private tickHandle: number | null = null;
  private blessed = false;
  /**
   * Element som VI själva strax ska pausa. 'pause'-event är asynkrona, så en
   * räknare räcker inte – varje avsiktlig paus märks per element och prickas
   * av i eventhanteraren. Övriga pause-event är externa avbrott (låsskärm,
   * samtal) och ska ändra motorns status.
   */
  private expectPause = new Set<HTMLAudioElement>();
  private startSeq = 0;
  private volumeDebounce: number | null = null;

  private listeners = new Set<(s: EngineState) => void>();

  /* ------------------------------------------------------------ publikt */

  getState(): EngineState {
    return {
      status: this.status,
      layers: this.layers.map((l) => ({ ...l })),
      timer: this.timer ? { ...this.timer } : null,
      startedAt: this.startedAt,
      bakedVolumeMode: this.bakedMode,
    };
  }

  subscribe(cb: (s: EngineState) => void): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }

  remainingMs(now = Date.now()): number | null {
    if (!this.timer || this.status === "idle") return null;
    return Math.max(0, this.timer.endsAt - now);
  }

  /**
   * "Välsigna" alla audio-element under en användargest så att senare
   * programmatiska play()-anrop (t.ex. blob-byten i bakat läge) tillåts.
   */
  bless(): void {
    if (this.blessed || this.status !== "idle") return;
    this.blessed = true;
    const silent = getSilentUrl();
    for (let i = 0; i < 4; i++) {
      const el = this.el(i);
      try {
        el.src = silent;
        void el
          .play()
          .then(() => {
            // Pausa bara om elementet fortfarande spelar tystnaden – start()
            // kan ha hunnit byta källa under tiden.
            if (el.src === silent) this.pauseEl(el);
          })
          .catch(() => undefined);
      } catch {
        /* ignorera */
      }
    }
  }

  /** Starta uppspelning. MÅSTE anropas synkront i en användargest. */
  start(cfg: StartConfig): void {
    const seq = ++this.startSeq;
    this.blessed = true; // starten är i sig en gest
    this.layers = cfg.layers.map((l) => ({ ...l }));
    this.maxVol = cfg.maxVol;
    this.status = "playing";
    this.startedAt = Date.now();
    this.setTimerInternal(cfg.timerMin, cfg.fadeOutMs);

    // Fade-in (i bakat läge startar vi direkt på målvolym – stegvisa
    // blob-byten under 3 s låter sämre än ingen fade).
    if (!this.bakedMode && cfg.fadeInMs > 300) {
      this.m = 0;
      this.beginFade(1, cfg.fadeInMs);
    } else {
      this.m = 1;
      this.fade = null;
    }

    // Tysta lager som inte används (vid färre lager än förut).
    for (let i = this.layers.length; i < 2; i++) this.detachLayer(i);

    for (let i = 0; i < this.layers.length; i++) {
      void this.attachLayer(i, seq);
    }
    this.ensureTicking();
    this.updateMediaSession();
    this.notify();
  }

  /** Byt ljud i ett lager (fungerar även under uppspelning). */
  changeSound(layerIdx: number, soundId: SoundId): void {
    if (!this.layers[layerIdx]) return;
    this.layers[layerIdx].soundId = soundId;
    if (this.status === "playing" || this.status === "stopping") {
      void this.attachLayer(layerIdx, this.startSeq);
    }
    this.updateMediaSession();
    this.notify();
  }

  /** Lägg till/ta bort mixlager under uppspelning. */
  setLayers(layers: LayerConfig[]): void {
    const prevCount = this.layers.length;
    this.layers = layers.map((l) => ({ ...l }));
    if (this.status === "playing" || this.status === "stopping") {
      for (let i = layers.length; i < prevCount; i++) this.detachLayer(i);
      for (let i = 0; i < layers.length; i++) {
        if (i >= prevCount) void this.attachLayer(i, this.startSeq);
      }
    }
    this.updateMediaSession();
    this.notify();
  }

  updateVolume(layerIdx: number, volume: number): void {
    const layer = this.layers[layerIdx];
    if (!layer) return;
    layer.volume = volume;
    if (this.status !== "playing" && this.status !== "stopping") return;
    if (!this.bakedMode) {
      this.applyElementVolumes();
    } else {
      // Debounce: baka om och byt blob när reglaget vilar.
      if (this.volumeDebounce !== null) window.clearTimeout(this.volumeDebounce);
      this.volumeDebounce = window.setTimeout(() => {
        this.volumeDebounce = null;
        void this.rebakeLayer(layerIdx);
      }, 350);
    }
  }

  setMaxVol(maxVol: number): void {
    this.maxVol = maxVol;
    if (this.status === "playing") {
      if (!this.bakedMode) this.applyElementVolumes();
      else for (let i = 0; i < this.layers.length; i++) void this.rebakeLayer(i);
    }
  }

  /** Tillfällig volymhöjning (vaktlägets "höj vid trigger"). */
  setBoost(mult: number): void {
    this.boost = mult;
    if (this.status === "playing") {
      if (!this.bakedMode) this.applyElementVolumes();
      else for (let i = 0; i < this.layers.length; i++) void this.rebakeLayer(i);
    }
  }

  /** Sätt/ändra insomningstimer. min=0 → hela natten. */
  setTimer(timerMin: number, fadeOutMs: number): void {
    this.setTimerInternal(timerMin, fadeOutMs);
    // En pågående timer-fade avbryts om timern ändras.
    if (this.status === "stopping") {
      this.status = "playing";
      this.fade = null;
      this.m = 1;
      if (!this.bakedMode) this.applyElementVolumes();
    }
    this.updateMediaSession();
    this.notify();
  }

  pause(): void {
    if (this.status !== "playing" && this.status !== "stopping") return;
    this.fade = null;
    if (this.bakedMode) {
      this.pauseElements();
      this.finishPause();
    } else {
      // Kort fade så att pausen inte blir ett klick.
      this.beginFade(0, 350, () => {
        this.pauseElements();
        this.finishPause();
      });
      this.status = "stopping";
    }
    this.notify();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "playing";
    if (!this.bakedMode) {
      this.m = 0;
      this.beginFade(1, 600);
    } else {
      this.m = 1;
    }
    for (let i = 0; i < this.layers.length; i++) {
      const el = this.el(layerSlot(i, this.activeSide[i]));
      void el.play().catch(() => undefined);
      // Stafettpartnern tillbaka till startläge.
      this.handing[i] = false;
      const partner = this.els[layerSlot(i, (this.activeSide[i] === 0 ? 1 : 0) as 0 | 1)];
      if (partner) {
        try {
          partner.currentTime = 0;
        } catch {
          /* ignorera */
        }
      }
    }
    this.applyElementVolumes();
    this.ensureTicking();
    this.updateMediaSession();
    this.notify();
  }

  /** Stoppa med fade (används av timer, vaktläge och stopp-knapp). */
  stop(fadeMs: number): void {
    if (this.status === "idle") return;
    if (this.status === "paused" || fadeMs < 200) {
      this.pauseElements();
      this.reset();
      return;
    }
    this.status = "stopping";
    this.beginFade(0, fadeMs, () => {
      this.pauseElements();
      this.reset();
    });
    this.updateMediaSession();
    this.notify();
  }

  /* ------------------------------------------------------------ internt */

  private notify(): void {
    const s = this.getState();
    for (const cb of this.listeners) cb(s);
  }

  private setTimerInternal(timerMin: number, fadeOutMs: number): void {
    this.timer =
      timerMin > 0
        ? { endsAt: Date.now() + timerMin * 60_000, fadeOutMs, totalMin: timerMin }
        : null;
  }

  private finishPause(): void {
    this.status = "paused";
    this.fade = null;
    this.m = 1;
    this.handing = [false, false];
    this.updateMediaSession();
    this.notify();
  }

  private reset(): void {
    this.status = "idle";
    this.fade = null;
    this.m = 1;
    this.timer = null;
    this.startedAt = null;
    this.boost = 1;
    this.handing = [false, false];
    this.stopTicking();
    this.updateMediaSession();
    this.notify();
  }

  private el(slot: number): HTMLAudioElement {
    let el = this.els[slot];
    if (!el) {
      el = new Audio();
      el.loop = true;
      el.preload = "auto";
      (el as unknown as { playsInline?: boolean }).playsInline = true;
      // Fäst i DOM: frikopplade element riskerar att skräpsamlas och är
      // svårare att felsöka.
      el.style.display = "none";
      document.body.appendChild(el);
      el.addEventListener("pause", () => this.onElementPause(el!));
      el.addEventListener("play", () => this.onElementPlay());
      el.addEventListener("ended", () => {
        // loop=true ska hindra detta; hör den ändå hit startar vi om.
        if (this.status === "playing") void el!.play().catch(() => undefined);
      });
      el.addEventListener("timeupdate", () => this.tick());
      this.els[slot] = el;
    }
    return el;
  }

  /** Pausa avsiktligt (utan att tolkas som externt avbrott). */
  private pauseEl(el: HTMLAudioElement): void {
    if (el.paused) return;
    this.expectPause.add(el);
    el.pause();
  }

  private onElementPause(el: HTMLAudioElement): void {
    if (this.expectPause.delete(el)) return;
    // Bara det AKTIVA elementet i lager 0 styr motorns status.
    if (el !== this.els[layerSlot(0, this.activeSide[0])]) return;
    if (this.status === "playing" || this.status === "stopping") {
      // Avbrott utifrån: låsskärmens paus, samtal, hörlurar urdragna …
      this.fade = null;
      this.m = 1;
      // Pausa ev. övriga lager så att mixen inte spelar ensam.
      this.pauseElements();
      this.finishPause();
    }
  }

  private onElementPlay(): void {
    if (this.status === "paused") {
      this.resume();
    }
  }

  private pauseElements(): void {
    for (const el of this.els) {
      if (el) this.pauseEl(el);
    }
  }

  private detachLayer(layerIdx: number): void {
    this.handing[layerIdx] = false;
    this.prepped[layerIdx] = false;
    for (const side of [0, 1] as const) {
      const el = this.els[layerSlot(layerIdx, side)];
      if (el) this.pauseEl(el);
    }
  }

  /**
   * Stafetten: gör systerelementet redo att ta över vid nästa loopgräns.
   * Partnern får samma (skarv-enveloperade) fil, står pausad på 0 och kan
   * därmed startas ögonblickligt inne i skarvfönstret.
   */
  private prepPartner(layerIdx: number, url: string): void {
    this.handing[layerIdx] = false;
    const cfg = this.layers[layerIdx];
    const partner = this.el(
      layerSlot(layerIdx, (this.activeSide[layerIdx] === 0 ? 1 : 0) as 0 | 1),
    );
    this.pauseEl(partner);
    partner.loop = true;
    if (partner.src !== url) partner.src = url;
    try {
      partner.currentTime = 0;
    } catch {
      /* före metadata – ofarligt */
    }
    this.prepped[layerIdx] = !!cfg && getSound(cfg.soundId).seamSec > 0;
  }

  private isCurrent(layerIdx: number, soundId: SoundId, seq: number): boolean {
    return (
      seq === this.startSeq &&
      this.layers[layerIdx]?.soundId === soundId &&
      (this.status === "playing" || this.status === "stopping")
    );
  }

  private async attachLayer(layerIdx: number, seq: number): Promise<void> {
    const cfg = this.layers[layerIdx];
    if (!cfg) return;
    const soundId = cfg.soundId;
    // Ingen stafett medan lagret laddar/byter ljud.
    this.handing[layerIdx] = false;
    this.prepped[layerIdx] = false;
    const side = this.activeSide[layerIdx];
    const el = this.el(layerSlot(layerIdx, side));
    el.loop = true;

    if (!this.bakedMode) {
      const ready = getReady(soundId);
      if (ready) {
        if (el.src !== ready.url) el.src = ready.url;
        void el.play().catch((e) => console.warn("play misslyckades", e));
        this.prepPartner(layerIdx, ready.url);
        this.applyElementVolumes();
        return;
      }
      // Blob inte klar: spela tystnad direkt i gesten, byt när ljudet finns.
      el.src = getSilentUrl();
      void el.play().catch(() => undefined);
      const entry = await ensureSound(soundId);
      if (!this.isCurrent(layerIdx, soundId, seq)) return;
      el.src = entry.url;
      void el.play().catch((e) => console.warn("play misslyckades", e));
      this.prepPartner(layerIdx, entry.url);
      this.applyElementVolumes();
      return;
    }

    // Bakat läge (iPhone): skala samples till aktuell volym och spela kopian.
    const gain = this.layerGain(layerIdx);
    const ready = getReady(soundId);
    if (ready?.samples) {
      const url = this.makeBakedUrl(layerIdx, side, ready.samples, gain);
      if (el.src !== url) el.src = url;
      el.volume = 1;
      void el.play().catch(() => undefined);
      this.lastBakedGain[layerIdx] = gain;
      this.prepPartner(
        layerIdx,
        this.makeBakedUrl(layerIdx, (side === 0 ? 1 : 0) as 0 | 1, ready.samples, gain),
      );
      return;
    }
    el.src = getSilentUrl();
    void el.play().catch(() => undefined);
    const entry = await ensureSound(soundId, { keepSamples: true });
    if (!this.isCurrent(layerIdx, soundId, seq)) return;
    const url = this.makeBakedUrl(layerIdx, side, entry.samples!, gain);
    el.src = url;
    el.volume = 1;
    void el.play().catch(() => undefined);
    this.lastBakedGain[layerIdx] = gain;
    this.prepPartner(
      layerIdx,
      this.makeBakedUrl(layerIdx, (side === 0 ? 1 : 0) as 0 | 1, entry.samples!, gain),
    );
  }

  private layerGain(layerIdx: number): number {
    const cfg = this.layers[layerIdx];
    if (!cfg) return 0;
    const boosted = Math.min(1, cfg.volume * this.boost);
    return sliderToGain(boosted * this.maxVol) * fadeMult(this.m);
  }

  private applyElementVolumes(): void {
    if (this.bakedMode) return;
    for (let i = 0; i < this.layers.length; i++) {
      const cfg = this.layers[i];
      const boosted = Math.min(1, cfg.volume * this.boost);
      const vol = effectiveGain(boosted, this.maxVol, this.m);
      // Båda sidorna: stafettpartnern ska ha rätt volym INNAN den startas.
      for (const side of [0, 1] as const) {
        const el = this.els[layerSlot(i, side)];
        if (el) el.volume = vol;
      }
    }
  }

  private makeBakedUrl(
    layerIdx: number,
    side: 0 | 1,
    samples: Float32Array,
    gain: number,
  ): string {
    const slot = layerSlot(layerIdx, side);
    const old = this.bakedUrls[slot];
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(wavBlob(scaledCopy(samples, gain), SR));
    this.bakedUrls[slot] = url;
    return url;
  }

  /** Bakat läge: rendera om lagrets blob med ny gain och byt element sömlöst. */
  private async rebakeLayer(layerIdx: number): Promise<void> {
    if (!this.bakedMode || this.bakeBusy[layerIdx]) return;
    const cfg = this.layers[layerIdx];
    if (!cfg) return;
    if (this.status !== "playing" && this.status !== "stopping") return;
    this.bakeBusy[layerIdx] = true;
    try {
      const gain = this.layerGain(layerIdx);
      if (Math.abs(gain - this.lastBakedGain[layerIdx]) < 0.004 && gain !== 0) return;
      const entry = await ensureSound(cfg.soundId, { keepSamples: true });
      if (this.status !== "playing" && this.status !== "stopping") return;

      const curSide = this.activeSide[layerIdx];
      const nextSide = (curSide === 0 ? 1 : 0) as 0 | 1;
      const cur = this.el(layerSlot(layerIdx, curSide));
      const next = this.el(layerSlot(layerIdx, nextSide));
      const url = this.makeBakedUrl(layerIdx, nextSide, entry.samples!, gain);

      next.loop = true;
      next.src = url;
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, 1200);
        next.addEventListener(
          "loadedmetadata",
          () => {
            window.clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
      if (this.status !== "playing" && this.status !== "stopping") return;
      try {
        if (Number.isFinite(cur.duration) && cur.duration > 0) {
          next.currentTime = cur.currentTime % cur.duration;
        }
      } catch {
        /* currentTime kan vägra före metadata – ofarligt för brus */
      }
      await next.play();
      this.pauseEl(cur);
      this.activeSide[layerIdx] = nextSide;
      this.lastBakedGain[layerIdx] = gain;
      // Stafettpartnern (gamla sidan) ska stå redo med samma gain.
      this.handing[layerIdx] = false;
      const partnerUrl = this.makeBakedUrl(layerIdx, curSide, entry.samples!, gain);
      cur.src = partnerUrl;
      try {
        cur.currentTime = 0;
      } catch {
        /* ignorera */
      }
    } catch (e) {
      console.warn("rebake misslyckades", e);
    } finally {
      this.bakeBusy[layerIdx] = false;
    }
  }

  /* ------------------------------------------------------------- fades */

  private beginFade(to: number, durMs: number, onDone?: () => void): void {
    const stepMs = Math.max(4000, durMs / 7);
    this.fade = {
      from: this.m,
      to,
      startAt: Date.now(),
      durMs,
      onDone,
      nextBakeAt: Date.now() + stepMs,
      stepMs,
    };
    this.ensureTicking();
  }

  private ensureTicking(): void {
    if (this.tickHandle === null) {
      this.tickHandle = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  private stopTicking(): void {
    if (this.tickHandle !== null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /**
   * Hjärtat: körs av setInterval OCH av audio-elementens timeupdate.
   * Att den drivs av timeupdate gör att fades och timer fungerar även när
   * skärmen är låst och JS-timers stryps – mediat spelar ju, så timeupdate
   * fortsätter komma.
   */
  tick(): void {
    const now = Date.now();

    // 1. Insomningstimer → starta lång fade-ut i tid.
    if (this.status === "playing" && this.timer) {
      const { endsAt, fadeOutMs } = this.timer;
      if (now >= endsAt) {
        this.stop(0);
        return;
      }
      if (now >= endsAt - fadeOutMs) {
        this.status = "stopping";
        this.beginFade(0, Math.max(1000, endsAt - now), () => {
          this.pauseElements();
          this.reset();
        });
        this.updateMediaSession();
        this.notify();
      }
    }

    // 2. Stafett-överlämning vid loopgränsen (ljud med inbakad skarv).
    if (this.status === "playing" || this.status === "stopping") this.relayTick();

    // 3. Pågående fade.
    const fade = this.fade;
    if (fade) {
      const p = Math.min(1, (now - fade.startAt) / fade.durMs);
      this.m = fade.from + (fade.to - fade.from) * p;
      if (!this.bakedMode) {
        this.applyElementVolumes();
      } else if (now >= fade.nextBakeAt && p < 1) {
        fade.nextBakeAt = now + fade.stepMs;
        for (let i = 0; i < this.layers.length; i++) void this.rebakeLayer(i);
      }
      if (p >= 1) {
        this.fade = null;
        this.m = fade.to;
        if (!this.bakedMode) this.applyElementVolumes();
        fade.onDone?.();
      }
    }
  }

  /**
   * Stafetten: strax före filslutet startas systerelementet, vars fil börjar
   * med samma equal power-fade som den aktivas fil slutar med – summan över
   * skarven är nivåkonstant utan att elementvolymen behöver röras (fungerar
   * därmed även i bakat läge på iPhone). Det aktiva elementet behåller
   * loop=true som skyddsnät: om JS är för hårt strypt för att armera i tid
   * faller det tillbaka till nativ loop (kort sökglapp) i stället för
   * tystnad – ljudet kan aldrig dö. Efter wrap pausas det gamla elementet;
   * dess korta läckage efter omslaget dämpas av filens egen infade.
   */
  private relayTick(): void {
    for (let i = 0; i < this.layers.length; i++) {
      if (!this.prepped[i] || this.bakeBusy[i]) continue;
      const side = this.activeSide[i];
      const slot = layerSlot(i, side);
      const active = this.els[slot];
      if (!active || active.paused) continue;
      const dur = active.duration;
      if (!Number.isFinite(dur) || dur <= 0) continue;
      const ct = active.currentTime;
      const partnerSide = (side === 0 ? 1 : 0) as 0 | 1;
      const partner = this.els[layerSlot(i, partnerSide)];
      if (!partner) continue;

      if (!this.handing[i]) {
        // Armera inne i skarvfönstret (+ marginal för glesa tick i bakgrund).
        const seam = getSound(this.layers[i].soundId).seamSec;
        if (dur - ct <= seam + 0.25 && dur - ct > 0.02) {
          this.handing[i] = true;
          try {
            if (partner.currentTime !== 0) partner.currentTime = 0;
          } catch {
            /* ignorera */
          }
          void partner.play().catch(() => {
            this.handing[i] = false;
          });
        }
      } else if (ct < this.lastCt[slot] - 1) {
        // Aktiva elementet har wrap:at (nativ loop som skyddsnät). Spelar
        // partnern tar den över; annars fortsätter det gamla och vi försöker
        // igen vid nästa varv.
        if (!partner.paused) {
          this.pauseEl(active);
          try {
            active.currentTime = 0;
          } catch {
            /* ignorera */
          }
          this.activeSide[i] = partnerSide;
        }
        this.handing[i] = false;
      }
      this.lastCt[slot] = ct;
    }
  }

  /* ------------------------------------------------------ media session */

  private updateMediaSession(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      if (this.status === "idle") {
        ms.playbackState = "none";
        return;
      }
      const titel =
        this.layers.map((l) => getSound(l.soundId).namn).join(" + ") || "Nattljud";
      const timerText = this.timer
        ? `Timer ${this.timer.totalMin} min`
        : "Hela natten";
      const base = import.meta.env.BASE_URL ?? "/";
      ms.metadata = new MediaMetadata({
        title: titel,
        artist: "Nattljud",
        album: timerText,
        artwork: [
          { src: `${base}icons/icon-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${base}icons/icon-512.png`, sizes: "512x512", type: "image/png" },
        ],
      });
      ms.playbackState =
        this.status === "playing" || this.status === "stopping" ? "playing" : "paused";
      ms.setActionHandler("play", () => this.resume());
      ms.setActionHandler("pause", () => this.pause());
      try {
        ms.setActionHandler("stop", () => this.stop(400));
      } catch {
        /* stop stöds inte överallt */
      }
    } catch (e) {
      console.warn("mediaSession", e);
    }
  }
}

function layerSlot(layerIdx: number, side: 0 | 1): number {
  return layerIdx * 2 + side;
}

/** Global singleton – appen har exakt en ljudmotor. */
export const engine = new NattEngine();
