import { useCallback, useEffect, useRef, useState } from "react";
import { engine, type EngineState } from "../audio/engine";
import { ensureSound, pregenerateAll } from "../audio/library";
import { getSound, SOUNDS, type SoundId } from "../audio/sounds";
import {
  loadSettings,
  saveSettings,
  type GuardSettings,
  type Preset,
  type Settings,
} from "../state/settings";
import { fmtRemaining } from "./format";
import { GuardView } from "./GuardView";
import { GearIcon, MoonIcon, PauseIcon, PlayIcon, ShieldIcon } from "./icons";
import { InfoView } from "./InfoView";
import { Presets } from "./Presets";
import { SoundGrid } from "./SoundGrid";
import { SuperDark } from "./SuperDark";
import { TimerChips } from "./TimerChips";
import { VolumeSlider } from "./VolumeSlider";

type View = "main" | "guard" | "info";

function layersFrom(s: Settings): { soundId: SoundId; volume: number }[] {
  const layers = [{ soundId: s.soundId, volume: s.volume }];
  if (s.mixOn) layers.push({ soundId: s.mixSoundId, volume: s.mixVolume });
  return layers;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [engineState, setEngineState] = useState<EngineState>(() => engine.getState());
  const [view, setView] = useState<View>("main");
  const [superDark, setSuperDark] = useState(false);
  const [, setClock] = useState(0);
  const idleRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const spelar = engineState.status === "playing" || engineState.status === "stopping";

  const upd = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  useEffect(() => engine.subscribe(setEngineState), []);
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Förgenerera ljuden i bakgrunden (valt ljud först) så att play-trycket
  // alltid har en färdig blob.
  useEffect(() => {
    void pregenerateAll([settingsRef.current.soundId, settingsRef.current.mixSoundId]);
  }, []);
  useEffect(() => {
    void ensureSound(settings.soundId, { keepSamples: engine.bakedMode });
  }, [settings.soundId]);
  useEffect(() => {
    if (settings.mixOn)
      void ensureSound(settings.mixSoundId, { keepSamples: engine.bakedMode });
  }, [settings.mixOn, settings.mixSoundId]);

  // Sekundklocka för "x min kvar".
  useEffect(() => {
    if (engineState.status === "idle") return;
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [engineState.status]);

  // Välsigna audio-elementen vid allra första gesten (autoplay-policy).
  useEffect(() => {
    const h = () => engine.bless();
    window.addEventListener("pointerdown", h, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", h, true);
  }, []);

  // Supermörk vy: gå in automatiskt efter 8 s stillhet under uppspelning.
  useEffect(() => {
    const rensa = () => {
      if (idleRef.current !== null) window.clearTimeout(idleRef.current);
      idleRef.current = null;
    };
    if (!(spelar && view === "main")) {
      rensa();
      setSuperDark(false);
      return;
    }
    const armera = () => {
      rensa();
      idleRef.current = window.setTimeout(() => setSuperDark(true), 8000);
    };
    armera();
    const onPointer = () => armera();
    window.addEventListener("pointerdown", onPointer);
    return () => {
      rensa();
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [spelar, view]);

  /* ------------------------------------------------------------ handlingar */

  const startaMed = useCallback((s: Settings) => {
    engine.start({
      layers: layersFrom(s),
      fadeInMs: s.fadeInSec * 1000,
      maxVol: s.maxVol,
      timerMin: s.timerMin,
      fadeOutMs: s.fadeOutMin * 60_000,
    });
  }, []);

  const onPlayPause = () => {
    if (engineState.status === "idle") startaMed(settings);
    else if (engineState.status === "paused") engine.resume();
    else engine.pause();
  };

  const väljLjud = (id: SoundId) => {
    const patch: Partial<Settings> = { soundId: id };
    if (id === settings.mixSoundId) {
      patch.mixSoundId = SOUNDS.find((s) => s.id !== id)!.id;
    }
    upd(patch);
    if (spelar) engine.changeSound(0, id);
  };

  const ändraVolym = (v: number) => {
    upd({ volume: v });
    engine.updateVolume(0, v);
  };

  const väljMixLjud = (id: SoundId) => {
    upd({ mixSoundId: id });
    if (spelar && settings.mixOn) engine.changeSound(1, id);
  };

  const ändraMixVolym = (v: number) => {
    upd({ mixVolume: v });
    engine.updateVolume(1, v);
  };

  const toggleMix = (on: boolean) => {
    upd({ mixOn: on });
    if (spelar) engine.setLayers(layersFrom({ ...settings, mixOn: on }));
  };

  const väljTimer = (min: number) => {
    upd({ timerMin: min });
    if (engineState.status !== "idle") {
      engine.setTimer(min, settings.fadeOutMin * 60_000);
    }
  };

  const sparaPreset = (namn: string) => {
    const p: Preset = {
      namn,
      soundId: settings.soundId,
      volume: settings.volume,
      mixOn: settings.mixOn,
      mixSoundId: settings.mixSoundId,
      mixVolume: settings.mixVolume,
      timerMin: settings.timerMin,
    };
    upd({ presets: [...settings.presets, p] });
  };

  const användPreset = (p: Preset) => {
    const s2: Settings = {
      ...settings,
      soundId: p.soundId,
      volume: p.volume,
      mixOn: p.mixOn,
      mixSoundId: p.mixSoundId,
      mixVolume: p.mixVolume,
      timerMin: p.timerMin,
    };
    setSettings(s2);
    startaMed(s2); // trycket på favoriten är gesten – spela direkt
  };

  const taBortPreset = (i: number) => {
    upd({ presets: settings.presets.filter((_, idx) => idx !== i) });
  };

  const updateGuard = (guard: GuardSettings) => upd({ guard });
  const buildLayers = useCallback(() => layersFrom(settingsRef.current), []);

  /* --------------------------------------------------------------- render */

  if (view === "guard") {
    return (
      <GuardView
        settings={settings}
        engineState={engineState}
        onUpdateGuard={updateGuard}
        onExit={() => setView("main")}
        buildLayers={buildLayers}
      />
    );
  }

  if (view === "info") {
    return <InfoView settings={settings} onUpdate={upd} onExit={() => setView("main")} />;
  }

  const remaining = engine.remainingMs();
  const ljudNamn = layersFrom(settings)
    .map((l) => getSound(l.soundId).namn)
    .join(" + ");

  return (
    <div className="app">
      {superDark && spelar && (
        <SuperDark
          ljudNamn={ljudNamn}
          remainingMs={remaining}
          onVakna={() => setSuperDark(false)}
          onPaus={() => engine.pause()}
        />
      )}

      <header className="topprad">
        <h1>Nattljud</h1>
        <div className="topprad-knappar">
          <button
            className="ikonknapp"
            onClick={() => setView("guard")}
            aria-label="Vaktläge (skriksensor)"
          >
            <ShieldIcon />
          </button>
          <button
            className="ikonknapp"
            onClick={() => setView("info")}
            aria-label="Inställningar och info"
          >
            <GearIcon />
          </button>
        </div>
      </header>

      <Presets
        presets={settings.presets}
        onAnvänd={användPreset}
        onSpara={sparaPreset}
        onTaBort={taBortPreset}
      />

      <SoundGrid vald={settings.soundId} onVälj={väljLjud} />

      <VolumeSlider label="Volym" value={settings.volume} onChange={ändraVolym} />

      <section className="mixsektion">
        <label className="togglerad">
          <input
            type="checkbox"
            checked={settings.mixOn}
            onChange={(e) => toggleMix(e.target.checked)}
          />
          <span>Mixa in ett andra ljud</span>
        </label>
        {settings.mixOn && (
          <>
            <SoundGrid
              kompakt
              vald={settings.mixSoundId}
              onVälj={väljMixLjud}
              exkludera={settings.soundId}
            />
            <VolumeSlider
              label={`Volym: ${getSound(settings.mixSoundId).namn}`}
              value={settings.mixVolume}
              onChange={ändraMixVolym}
            />
          </>
        )}
      </section>

      <section className="faltgrupp">
        <span className="faltrubrik">Insomningstimer</span>
        <TimerChips vald={settings.timerMin} onVälj={väljTimer} />
        <p className="dim liten">
          {settings.timerMin === 0
            ? "Spelar tills du stänger av."
            : `Tonar ut mjukt under ${settings.fadeOutMin} min i slutet.`}
        </p>
      </section>

      <div className="playbar-spacer" />
      <div className="playbar">
        <div className="playbar-sida">
          {spelar && (
            <button
              className="ikonknapp nattvy"
              onClick={() => setSuperDark(true)}
              aria-label="Nattvy (nästan svart skärm)"
            >
              <MoonIcon />
            </button>
          )}
        </div>
        <button
          className={`playknapp${spelar ? " aktiv" : ""}`}
          onClick={onPlayPause}
          aria-label={spelar ? "Pausa" : "Spela"}
        >
          {spelar ? <PauseIcon size={42} /> : <PlayIcon size={42} />}
        </button>
        <div className="playbar-sida playbar-status">
          {spelar
            ? remaining !== null
              ? fmtRemaining(remaining)
              : "hela natten"
            : engineState.status === "paused"
              ? "pausad"
              : ""}
        </div>
      </div>
    </div>
  );
}
