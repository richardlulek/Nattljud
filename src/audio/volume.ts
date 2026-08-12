/**
 * Volymkurvor. Reglaget är linjärt 0..1 men örat är logaritmiskt – en
 * kvadratisk kurva ger fin kontroll på låga nivåer (halva reglaget ≈ -12 dB)
 * och approximerar en logaritmisk kurva utan diskontinuitet vid noll.
 * (Var tidigare kubisk, men -18 dB vid halva reglaget gjorde appen för tyst.)
 */
export function sliderToGain(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x * x;
}

/**
 * Fade-multiplikator. m går linjärt 0..1 i tiden; utväxlingen görs i dB
 * (-60 dB → 0 dB) så att faden UPPLEVS jämn. m=0 ger exakt 0 (tystnad).
 */
export function fadeMult(m: number): number {
  if (m <= 0) return 0;
  if (m >= 1) return 1;
  return Math.pow(10, ((m - 1) * 60) / 20);
}

/** Slutlig elementvolym/bakad gain för ett lager. */
export function effectiveGain(sliderValue: number, maxVol: number, fadeM: number): number {
  return sliderToGain(sliderValue * maxVol) * fadeMult(fadeM);
}
