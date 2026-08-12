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
