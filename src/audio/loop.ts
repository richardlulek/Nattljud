/**
 * Verktyg för sömlösa loopar och nivåer.
 */

/**
 * Gör en loop sömlös genom att baka in en crossfade i filen:
 * indata renderas `fadeLen` samples LÄNGRE än loopen, och loopens början
 * blandas (equal power) med "fortsättningen" efter loopens slut. När
 * uppspelningen då hoppar från sista samplet till det första hörs ingen skarv
 * – det första partiet ÄR en blandning av start och naturlig fortsättning.
 *
 * @param rendered  loopLängd + fadeLen samples
 * @param loopLen   antal samples i den färdiga loopen
 * @param fadeLen   antal samples crossfade (t.ex. 0.6 s)
 */
export function bakeSeamlessLoop(
  rendered: Float32Array,
  loopLen: number,
  fadeLen: number,
): Float32Array {
  if (rendered.length < loopLen + fadeLen) {
    throw new Error(
      `bakeSeamlessLoop: behöver ${loopLen + fadeLen} samples, fick ${rendered.length}`,
    );
  }
  const out = new Float32Array(loopLen);
  out.set(rendered.subarray(0, loopLen));
  for (let i = 0; i < fadeLen; i++) {
    // Equal power-blandning: sin/cos håller upplevd nivå konstant för brus.
    const t = (i / fadeLen) * (Math.PI / 2);
    const wIn = Math.sin(t); // loopens egen start fadas in
    const wOut = Math.cos(t); // svansen efter loopslutet fadas ut
    out[i] = out[i] * wIn + rendered[loopLen + i] * wOut;
  }
  return out;
}

/** Mål-RMS för alla ljud (dBFS): satt till det tätaste ljudets naturliga
 *  nivå vid peak-normalisering, så att inget ljud sänks – övriga höjs till
 *  samma upplevda nivå. */
export const TARGET_RMS_DB = -12;
/** Absolut toppnivå efter limitern (≈ -0.2 dBFS). */
export const PEAK_CEILING = 0.98;
/** Andel av taket där soft-clippens mättnad börjar. */
const KNEE = 0.7;

/**
 * Loudness-normalisering med mjuk limiter. Peak-normalisering låter korta
 * toppar (hjärtslag, regndroppar, vågbrott) diktera nivån så att hela mattan
 * trycks ner – men örat hör medelnivån (RMS), inte toppen. Här skalas ljudet
 * till mål-RMS och topparna tyglas med en C¹-kontinuerlig soft knee-klippare:
 * linjär under KNEE·tak, tanh-mättnad ovanför, |ut| ≤ tak.
 */
export function normalizeLoudness(
  samples: Float32Array,
  targetRmsDb = TARGET_RMS_DB,
  ceiling = PEAK_CEILING,
): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms <= 0) return samples;
  const g = Math.pow(10, targetRmsDb / 20) / rms;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i] * g;
    const a = Math.abs(x) / ceiling;
    samples[i] =
      a <= KNEE
        ? x
        : Math.sign(x) *
          ceiling *
          (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
  }
  return samples;
}

/**
 * Stafett-kuvert för sömlös överlämning mellan två <audio>-element:
 * equal power-fade-in över filens första `seamSec` och spegelvänd fade-ut
 * över de sista. När element B startas i A:s utfadningsfönster är summan
 * nivåkonstant (sin²+cos² = 1) för brus. Crossfaden ligger alltså i FILEN –
 * ingen volymstyrning behövs vid överlämningen, vilket är kravet på iPhone
 * där JS inte får röra elementvolymen.
 */
export function applyRelayEnvelope(
  samples: Float32Array,
  sr: number,
  seamSec: number,
): Float32Array {
  const L = Math.min(Math.floor(seamSec * sr), Math.floor(samples.length / 2));
  for (let i = 0; i < L; i++) {
    const w = Math.sin(((i / L) * Math.PI) / 2);
    samples[i] *= w;
    samples[samples.length - 1 - i] *= w;
  }
  return samples;
}

/** Normalisera till given toppnivå (default 0.89 ≈ -1 dBFS). */
export function normalizePeak(samples: Float32Array, target = 0.89): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const g = target / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= g;
  }
  return samples;
}

/** Skala till en ny buffert (används för "bakad volym" på iPhone). */
export function scaledCopy(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}
