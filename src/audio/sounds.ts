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
export const GEN_VERSION = 4;

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

  // Grundskur: mörkare och mjukare än v1 (som var vass i toppen och tunn i
  // botten). En dov "fönsterkropp" ger skuren tyngd. LFO-frekvenserna är
  // hela antal cykler per loop → loopbart.
  const rng = mulberry32(0xa11e);
  const hp = Biquad.highpass(sr, 240, 0.7);
  const lp = Biquad.lowpass(sr, nyq(sr, 6800), 0.7);
  const tilt = Biquad.highshelf(sr, nyq(sr, 2600), -7);
  const rngB = mulberry32(0xb0d7);
  const body = Biquad.lowpass(sr, nyq(sr, 420), 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const lfo =
      1 +
      0.08 * Math.sin((2 * Math.PI * 3 * t) / loopSec + 0.7) +
      0.05 * Math.sin((2 * Math.PI * 7 * t) / loopSec + 2.4);
    const skur = tilt.process(lp.process(hp.process(signed(rng)))) * 0.42;
    const grund = body.process(signed(rngB)) * 0.5;
    buf[i] = (skur + grund) * lfo;
  }

  // Droppar: tätare men mjukare "plipp" än v1:s klickiga pling. Längre
  // ansats, lägre Q och mörkare färg låter dem smälta ihop till ett porl i
  // stället för att sticka ut som knäppar.
  const rngD = mulberry32(0xd809);
  let t = 0.005;
  const rate = 26; // droppar per sekund (Poisson)
  while (t < loopSec + CROSSFADE_SEC - 0.03) {
    t += -Math.log(1 - rngD()) / rate;
    const startI = Math.round(t * sr);
    const lenSec = 0.007 + rngD() * 0.016;
    const len = Math.max(12, Math.round(lenSec * sr));
    if (startI + len >= n) break;
    const fc = nyq(sr, 650 * Math.exp(rngD() * Math.log(5.5))); // 650–3600 Hz, log-fördelat
    const amp = 0.04 + 0.16 * rngD() * rngD();
    const bpf = Biquad.bandpass(sr, fc, 1.6);
    const attack = Math.max(4, Math.round(len * 0.3));
    for (let i = 0; i < len; i++) {
      const env =
        i < attack
          ? (1 - Math.cos((i / attack) * Math.PI)) / 2
          : Math.exp(-((i - attack) / (len * 0.4)));
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

  // v1:s periodiska vibrato på en ren övertonsstack lät som en syntorgel.
  // Nu: tio övertoner med brantare spektralfall, ett svagt SLUMPMÄSSIGT
  // fladder (LP-filtrerat brus som FM – riktiga motorer vobblar inte i takt)
  // och turbulent "grovkornighet" i luftbruset. Tonen är nedmixad – det är
  // luften man ska höra, motorn bara anas. (FM:en bryter tonens exakta
  // loopfas, men skarven ligger helt inne i stafettens crossfade-fönster.)
  const f0 = 96;
  const harmPhase = [0.0, 1.7, 3.1, 4.9, 0.6, 2.2, 5.5, 1.1, 3.8, 0.3];
  const rngF = mulberry32(0xf1ad);
  const flutterLp = Biquad.lowpass(sr, 5.5, 0.7);
  const rng = mulberry32(0x7a11);
  const rngH = mulberry32(0x8155);
  const rngT = mulberry32(0x70bb);
  const hpN = Biquad.highpass(sr, 200, 0.7);
  const lpN = Biquad.lowpass(sr, nyq(sr, 5200), 0.7);
  const shelf = Biquad.lowshelf(sr, 520, 4);
  const hiss = Biquad.highpass(sr, nyq(sr, 2600), 0.7);
  const turbLp = Biquad.lowpass(sr, 80, 0.7);
  let phi = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const flutter = flutterLp.process(signed(rngF)) * 40; // ±~1 Hz slumpfladder
    phi += (2 * Math.PI * (f0 + flutter)) / sr;
    let tone = 0;
    for (let h = 1; h <= 10; h++) {
      tone += Math.sin(h * phi + harmPhase[h - 1]) / Math.pow(h, 1.7);
    }
    const body = shelf.process(lpN.process(hpN.process(signed(rng))));
    const luft = hiss.process(signed(rngH));
    const grov = 1 + 3.5 * turbLp.process(signed(rngT)); // luftens grovkornighet
    const lfo = 1 + 0.03 * Math.sin((2 * Math.PI * 2 * t) / loopSec + 0.3);
    buf[i] = (tone * 0.16 + (body * 0.95 + luft * 0.18) * grov) * lfo;
  }
  return finish(buf, loopLen, fadeLen);
}

/* ------------------------------------------------------------------ vågor */

function renderVagor(sr: number): Float32Array {
  const loopLen = Math.round(55 * sr);
  const fadeLen = Math.round(CROSSFADE_SEC * sr);
  const n = loopLen + fadeLen;

  // Tre kontinuerliga brusströmmar med olika färg. v1:s vågbrott var
  // fullbands-vitt (lät som statiska brusexplosioner) – nu är dånet mörkt
  // och skummets fräs ligger i en egen, bredare ström.
  const rng = mulberry32(0x0cea);
  const swell = new Float32Array(n);
  const crash = new Float32Array(n);
  const hiss = new Float32Array(n);
  let acc = 0;
  const lpSwell = Biquad.lowpass(sr, 320, 0.8);
  const hpCrash = Biquad.highpass(sr, 190, 0.7);
  const lpCrash = Biquad.lowpass(sr, nyq(sr, 3200), 0.7);
  const tiltCrash = Biquad.highshelf(sr, nyq(sr, 1600), -5);
  const hpHiss = Biquad.highpass(sr, 1300, 0.7);
  const lpHiss = Biquad.lowpass(sr, nyq(sr, 6400), 0.7);
  for (let i = 0; i < n; i++) {
    const w = signed(rng);
    acc = (acc + 0.02 * w) / 1.02;
    swell[i] = lpSwell.process(acc * 3.5);
    crash[i] = tiltCrash.process(lpCrash.process(hpCrash.process(w)));
    hiss[i] = lpHiss.process(hpHiss.process(w));
  }

  // …formade av vågkuvert. Fem vågor per loop, seedad jitter (konstant).
  // Mjukare ansats och längre utrullning än v1 – vågen "välver" i stället
  // för att smälla till.
  const rngW = mulberry32(0x3a6e);
  const envSwell = new Float32Array(n);
  const envCrash = new Float32Array(n);
  const envHiss = new Float32Array(n);
  const starts = [1.2, 12.3, 23.1, 33.8, 44.6].map((s) => s + (rngW() - 0.5) * 1.6);
  for (const s of starts) {
    const size = 0.75 + rngW() * 0.5;
    const swellDur = 3.2;
    const from = Math.max(0, Math.floor(s * sr));
    const to = Math.min(n, Math.ceil((s + 11) * sr));
    for (let i = from; i < to; i++) {
      const t = i / sr - s;
      if (t < 0) continue;
      // Dyningen växer, bryts och dör ut.
      if (t < swellDur) {
        const x = Math.sin((t / swellDur) * (Math.PI / 2));
        envSwell[i] += x * x * 0.5 * size;
      } else {
        envSwell[i] += Math.exp(-(t - swellDur) / 1.6) * 0.5 * size;
      }
      // Dånet startar när dyningen toppar – mjuk ansats, lång utrullning.
      const tc = t - swellDur;
      if (tc >= 0) {
        const a = 1 - Math.exp(-tc / 0.38);
        envCrash[i] += a * Math.exp(-tc / 2.6) * 0.9 * size;
        // Skummets fräs i efterdyningen.
        const th = tc - 0.35;
        if (th >= 0) {
          envHiss[i] += (1 - Math.exp(-th / 0.5)) * Math.exp(-th / 3.2) * 0.34 * size;
        }
      }
    }
  }

  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Konstant djup botten så att det aldrig blir helt tyst mellan vågorna.
    buf[i] = swell[i] * (0.32 + envSwell[i]) + crash[i] * envCrash[i] + hiss[i] * envHiss[i];
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

  // "Sh"-spektrum: v1:s enda smala band kring 2,6 kHz lät som en vissling.
  // Tre parallella band ger den breda, luftiga klang ett riktigt "shhh" har,
  // och en långsam andningsgrovhet gör det levande.
  const rng = mulberry32(0x545e);
  const hp = Biquad.highpass(sr, 1000, 0.7);
  const bp1 = Biquad.bandpass(sr, nyq(sr, 2300), 0.8);
  const bp2 = Biquad.bandpass(sr, nyq(sr, 3600), 1.1);
  const bp3 = Biquad.bandpass(sr, nyq(sr, 5200), 1.6);
  const rngBr = mulberry32(0xb4ea);
  const breath = Biquad.lowpass(sr, 12, 0.7);
  const stream = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = hp.process(signed(rng));
    const sh = bp1.process(w) + 0.7 * bp2.process(w) + 0.4 * bp3.process(w);
    stream[i] = sh * (1 + 5 * breath.process(signed(rngBr)));
  }

  // Kuvert per cykel: mänsklig andningsbåge (kraftigast i början, mjukt
  // avtagande) i stället för v1:s mekaniska platå. Cykeln slutar fortfarande
  // i tystnad – loopgränsen ligger kvar i det tysta partiet.
  const rngC = mulberry32(0x1b0b);
  const env = new Float32Array(n);
  const totalCycles = Math.ceil(n / periodLen);
  for (let c = 0; c < totalCycles; c++) {
    const onLen = 0.84 * (1 + (rngC() - 0.5) * 0.09);
    const level = 1 + (rngC() - 0.5) * 0.16;
    const attack = 0.16;
    const release = 0.24;
    const startI = c * periodLen;
    const endI = Math.min(n, startI + Math.round((onLen + release) * sr));
    for (let i = startI; i < endI; i++) {
      const t = (i - startI) / sr;
      let e = 0;
      if (t < attack) e = 0.5 - 0.5 * Math.cos((t / attack) * Math.PI);
      else if (t < onLen)
        e = 0.55 + 0.45 * Math.cos(((t - attack) / Math.max(0.01, onLen - attack)) * (Math.PI / 2));
      else if (t < onLen + release)
        e = 0.55 * (0.5 + 0.5 * Math.cos(((t - onLen) / release) * Math.PI));
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
