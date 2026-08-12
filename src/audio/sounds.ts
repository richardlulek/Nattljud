/**
 * Ljudbiblioteket. Alla åtta ljud syntetiseras deterministiskt i ren TS
 * (inga licensfrågor, inga nedladdningar, testbart i Node) och renderas till
 * WAV-blobbar som spelas i <audio loop>-element.
 *
 * Varje renderare producerar loopLängd + CROSSFADE samples kontinuerligt
 * material; bakeSeamlessLoop blandar sedan in "fortsättningen" i loopstarten
 * så att loopen är sömlös per konstruktion.
 */
import { Biquad } from "./filters";
import { applyRelayEnvelope, bakeSeamlessLoop, normalizeLoudness } from "./loop";
import { mulberry32, signed } from "./prng";

export const SR = 44100;
/** Bumpa när DSP:n ändras så att gamla IndexedDB-cachar ogiltigförklaras. */
export const GEN_VERSION = 3;

const CROSSFADE_SEC = 0.6;

export type SoundId =
  | "vitt"
  | "rosa"
  | "brunt"
  | "hjartslag"
  | "regn"
  | "hartork"
  | "vagor"
  | "hyssj";

export interface SoundDef {
  id: SoundId;
  namn: string;
  beskrivning: string;
  /**
   * Stafettskarvens längd i sekunder (equal power-fade i filens ändar) för
   * motorns tvåelements-överlämning. 0 = ingen skarv: ljudet slutar redan i
   * tystnad (hjärtslag, hyssj) och loopas nativt – elementloopens ~100 ms
   * långa omstartssökning hamnar då i det tysta partiet och hörs inte.
   */
  seamSec: number;
  render: (sr: number) => Float32Array;
}

function finish(rendered: Float32Array, loopLen: number, fadeLen: number): Float32Array {
  return normalizeLoudness(bakeSeamlessLoop(rendered, loopLen, fadeLen));
}

/** Håll filterfrekvenser säkert under Nyquist (viktigt vid låg samplerate). */
function nyq(sr: number, f: number): number {
  return Math.min(f, sr * 0.45);
}

/* ------------------------------------------------------------------ brus */

function renderVitt(sr: number): Float32Array {
  const loopLen = Math.round(32 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;
  const buf = new Float32Array(n);
  const rng = mulberry32(0x51a1);
  // Mjuk topp – rent vitt brus är obehagligt vasst i mobilhögtalare.
  const lp = Biquad.lowpass(sr, nyq(sr, 14000));
  for (let i = 0; i < n; i++) buf[i] = lp.process(signed(rng));
  return finish(buf, loopLen, fadeLen);
}

function renderRosa(sr: number): Float32Array {
  const loopLen = Math.round(32 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;
  const buf = new Float32Array(n);
  const rng = mulberry32(0x905a);
  // Paul Kellets klassiska rosa brus-approximation (-3 dB/oktav).
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = signed(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    buf[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return finish(buf, loopLen, fadeLen);
}

function renderBrunt(sr: number): Float32Array {
  const loopLen = Math.round(32 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;
  const buf = new Float32Array(n);
  const rng = mulberry32(0xb60);
  // Läckande integrator (-6 dB/oktav) + högpass som tar bort DC-drift.
  let acc = 0;
  const hp = Biquad.highpass(sr, 26, 0.7);
  for (let i = 0; i < n; i++) {
    acc = (acc + 0.02 * signed(rng)) / 1.02;
    buf[i] = hp.process(acc * 3.5);
  }
  return finish(buf, loopLen, fadeLen);
}

/* -------------------------------------------------------------- hjärtslag */

function renderHjartslag(sr: number): Float32Array {
  // Exakt 40 slag ger en per konstruktion sömlös loop (~36 s vid 67 bpm).
  const beatLen = Math.round(0.9 * sr);
  const beats = 40;
  const loopLen = beatLen * beats;
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;

  // Bygg ETT slag ("lubb-dubb") och kakla det.
  const beat = new Float32Array(beatLen);
  const thump = (
    startSec: number,
    f0: number,
    f1: number,
    glideTau: number,
    attackSec: number,
    decayTau: number,
    amp: number,
  ) => {
    let phase = 0;
    const startI = Math.round(startSec * sr);
    for (let i = startI; i < beatLen; i++) {
      const t = (i - startI) / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / glideTau);
      phase += (2 * Math.PI * f) / sr;
      const env = t < attackSec ? t / attackSec : Math.exp(-(t - attackSec) / decayTau);
      if (env < 1e-4 && t > attackSec) break;
      // Mjuk vågformning ger övertoner så att slaget hörs i mobilhögtalare.
      beat[i] += Math.tanh(2.2 * Math.sin(phase)) * env * amp;
    }
  };
  thump(0.0, 140, 55, 0.06, 0.006, 0.1, 1.0); // lubb
  thump(0.34, 115, 50, 0.05, 0.005, 0.075, 0.62); // dubb

  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = beat[i % beatLen];

  // Dova till klangen och lägg en långsam andning i nivån (2 hela cykler
  // per loop → sömlöst).
  const lp = Biquad.lowpass(sr, 400, 0.8);
  const loopSec = loopLen / sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const lfo = 1 + 0.05 * Math.sin((2 * Math.PI * 2 * t) / loopSec + 1.1);
    buf[i] = lp.process(buf[i]) * lfo;
  }
  return finish(buf, loopLen, fadeLen);
}

/* ------------------------------------------------------------------- regn */

function renderRegn(sr: number): Float32Array {
  const loopLen = Math.round(56 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;
  const buf = new Float32Array(n);
  const loopSec = loopLen / sr;

  // Grundskur: bandbegränsat sus med långsam, loopbar variation
  // (LFO-frekvenserna är hela antal cykler per loop).
  const rng = mulberry32(0xa11e);
  const hp = Biquad.highpass(sr, 420, 0.7);
  const lp = Biquad.lowpass(sr, nyq(sr, 8200), 0.7);
  const tilt = Biquad.highshelf(sr, nyq(sr, 3400), -3.5);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const lfo =
      1 +
      0.09 * Math.sin((2 * Math.PI * 3 * t) / loopSec + 0.7) +
      0.06 * Math.sin((2 * Math.PI * 7 * t) / loopSec + 2.4);
    buf[i] = tilt.process(lp.process(hp.process(signed(rng)))) * 0.5 * lfo;
  }

  // Enskilda droppar: korta bandpassade knäppar med slumpad färg.
  const rngD = mulberry32(0xd809);
  let t = 0.005;
  const rate = 17; // droppar per sekund (Poisson)
  while (t < loopSec + CROSSFADE_SEC - 0.03) {
    t += -Math.log(1 - rngD()) / rate;
    const startI = Math.round(t * sr);
    const lenSec = 0.004 + rngD() * 0.011;
    const len = Math.max(8, Math.round(lenSec * sr));
    if (startI + len >= n) break;
    const fc = nyq(sr, 900 * Math.exp(rngD() * Math.log(7.2))); // 900–6500 Hz, log-fördelat
    const amp = 0.07 + 0.3 * rngD() * rngD();
    const bpf = Biquad.bandpass(sr, fc, 2.5);
    const attack = Math.max(2, Math.round(len * 0.15));
    for (let i = 0; i < len; i++) {
      const env = i < attack ? i / attack : Math.exp(-((i - attack) / (len * 0.35)));
      buf[startI + i] += bpf.process(signed(rngD)) * env * amp;
    }
  }
  return finish(buf, loopLen, fadeLen);
}

/* ---------------------------------------------------------------- hårtork */

function renderHartork(sr: number): Float32Array {
  const loopLen = Math.round(30 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;
  const buf = new Float32Array(n);
  const loopSec = loopLen / sr;

  // Motorton: grundton + övertoner med vibrato. f0 och vibratofrekvensen är
  // valda så att fasen går jämnt ut vid loopgränsen (98·30 och 4.3·30 är
  // heltal) – tonen loopar därmed exakt.
  const f0 = 98;
  const fv = 4.3;
  const depth = 0.011;
  const harmPhase = [0.0, 1.7, 3.1, 4.9, 0.6, 2.2, 5.5];
  const rng = mulberry32(0x7a11);
  const hpN = Biquad.highpass(sr, 240, 0.7);
  const lpN = Biquad.lowpass(sr, nyq(sr, 3900), 0.7);
  const shelf = Biquad.lowshelf(sr, 620, 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const phi = 2 * Math.PI * f0 * t - ((f0 * depth) / fv) * Math.cos(2 * Math.PI * fv * t);
    let tone = 0;
    for (let h = 1; h <= 7; h++) {
      tone += Math.sin(h * phi + harmPhase[h - 1]) / Math.pow(h, 1.35);
    }
    const noise = shelf.process(lpN.process(hpN.process(signed(rng))));
    const lfo = 1 + 0.04 * Math.sin((2 * Math.PI * 2 * t) / loopSec + 0.3);
    buf[i] = (tone * 0.3 + noise * 0.85) * lfo;
  }
  return finish(buf, loopLen, fadeLen);
}

/* ------------------------------------------------------------------ vågor */

function renderVagor(sr: number): Float32Array {
  const loopLen = Math.round(55 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;

  // Tre kontinuerliga brusströmmar med olika färg…
  const rng = mulberry32(0x0cea);
  const swell = new Float32Array(n);
  const crash = new Float32Array(n);
  const hiss = new Float32Array(n);
  let acc = 0;
  const lpSwell = Biquad.lowpass(sr, 340, 0.8);
  const hpCrash = Biquad.highpass(sr, 260, 0.7);
  const lpCrash = Biquad.lowpass(sr, nyq(sr, 5200), 0.7);
  const bpHiss = Biquad.bandpass(sr, 1900, 0.8);
  for (let i = 0; i < n; i++) {
    const w = signed(rng);
    acc = (acc + 0.02 * w) / 1.02;
    swell[i] = lpSwell.process(acc * 3.5);
    crash[i] = lpCrash.process(hpCrash.process(w));
    hiss[i] = bpHiss.process(w);
  }

  // …formade av vågkuvert. Fem vågor per loop, seedad jitter (konstant).
  const rngW = mulberry32(0x3a6e);
  const envSwell = new Float32Array(n);
  const envCrash = new Float32Array(n);
  const envHiss = new Float32Array(n);
  const starts = [1.2, 12.3, 23.1, 33.8, 44.6].map((s) => s + (rngW() - 0.5) * 1.6);
  for (const s of starts) {
    const size = 0.8 + rngW() * 0.4;
    const swellDur = 3.2;
    const from = Math.max(0, Math.floor(s * sr));
    const to = Math.min(n, Math.ceil((s + 10) * sr));
    for (let i = from; i < to; i++) {
      const t = i / sr - s;
      if (t < 0) continue;
      // Dyningen växer, bryts och dör ut.
      if (t < swellDur) {
        const x = Math.sin((t / swellDur) * (Math.PI / 2));
        envSwell[i] += x * x * 0.5 * size;
      } else {
        envSwell[i] += Math.exp(-(t - swellDur) / 1.4) * 0.5 * size;
      }
      // Bruset (crash) startar när dyningen toppar.
      const tc = t - swellDur;
      if (tc >= 0) {
        const a = 1 - Math.exp(-tc / 0.22);
        envCrash[i] += a * Math.exp(-tc / 2.1) * 0.95 * size;
        // Svischet i efterdyningen.
        const th = tc - 0.35;
        if (th >= 0) {
          envHiss[i] += (1 - Math.exp(-th / 0.5)) * Math.exp(-th / 3.0) * 0.3 * size;
        }
      }
    }
  }

  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Konstant djup botten så att det aldrig blir helt tyst mellan vågorna.
    buf[i] = swell[i] * (0.28 + envSwell[i]) + crash[i] * envCrash[i] + hiss[i] * envHiss[i];
  }
  return finish(buf, loopLen, fadeLen);
}

/* ------------------------------------------------------------------ hyssj */

function renderHyssj(sr: number): Float32Array {
  // 24 "shhh"-cykler à 1,3 s = 31,2 s, sömlöst per konstruktion.
  const periodLen = Math.round(1.3 * sr);
  const cycles = 24;
  const loopLen = periodLen * cycles;
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;

  // "Sh"-spektrum: bandpassat brus kring 2,6 kHz.
  const rng = mulberry32(0x545e);
  const bp = Biquad.bandpass(sr, 2600, 0.9);
  const hp = Biquad.highpass(sr, 900, 0.7);
  const stream = new Float32Array(n);
  for (let i = 0; i < n; i++) stream[i] = hp.process(bp.process(signed(rng)));

  // Kuvert per cykel med liten seedad variation så det låter mänskligt.
  const rngC = mulberry32(0x1b0b);
  const env = new Float32Array(n);
  const totalCycles = Math.ceil(n / periodLen);
  for (let c = 0; c < totalCycles; c++) {
    const onLen = 0.82 * (1 + (rngC() - 0.5) * 0.09);
    const level = 1 + (rngC() - 0.5) * 0.16;
    const attack = 0.14;
    const release = 0.2;
    const startI = c * periodLen;
    const endI = Math.min(n, startI + Math.round((onLen + release) * sr));
    for (let i = startI; i < endI; i++) {
      const t = (i - startI) / sr;
      let e = 0;
      if (t < attack) e = 0.5 - 0.5 * Math.cos((t / attack) * Math.PI);
      else if (t < onLen) e = 1 - 0.15 * ((t - attack) / Math.max(0.01, onLen - attack));
      else if (t < onLen + release)
        e = 0.85 * (0.5 + 0.5 * Math.cos(((t - onLen) / release) * Math.PI));
      env[i] = Math.max(env[i], e * level);
    }
  }

  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = stream[i] * env[i];
  return finish(buf, loopLen, fadeLen);
}

/* ------------------------------------------------------------------------ */

export const SOUNDS: SoundDef[] = [
  { id: "vitt", namn: "Vitt brus", beskrivning: "Klassiskt jämnt brus", seamSec: 2.4, render: renderVitt },
  { id: "rosa", namn: "Rosa brus", beskrivning: "Mjukare, ofta bäst för spädbarn", seamSec: 2.4, render: renderRosa },
  { id: "brunt", namn: "Brunt brus", beskrivning: "Djupast och dovast", seamSec: 2.4, render: renderBrunt },
  { id: "hjartslag", namn: "Hjärtslag", beskrivning: "Lugn puls, som i magen", seamSec: 0, render: renderHjartslag },
  { id: "regn", namn: "Regn", beskrivning: "Stadigt regn mot fönster", seamSec: 2.4, render: renderRegn },
  { id: "hartork", namn: "Hårtork", beskrivning: "Motorbrum och luft", seamSec: 2.4, render: renderHartork },
  { id: "vagor", namn: "Havsvågor", beskrivning: "Långsamma vågor mot strand", seamSec: 2.4, render: renderVagor },
  { id: "hyssj", namn: "Hyssjande", beskrivning: "Rytmiskt shhh… shhh…", seamSec: 0, render: renderHyssj },
];

export function getSound(id: SoundId): SoundDef {
  const def = SOUNDS.find((s) => s.id === id);
  if (!def) throw new Error(`Okänt ljud: ${id}`);
  return def;
}

export function renderSound(id: SoundId, sr: number = SR): Float32Array {
  const def = getSound(id);
  const buf = def.render(sr);
  return def.seamSec > 0 ? applyRelayEnvelope(buf, sr, def.seamSec) : buf;
}
