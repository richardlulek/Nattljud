/**
 * Ren beslutslogik för skriksensorn – ingen mikrofon, bara nivåvärden in och
 * triggerbeslut ut. Testbar i Node och återanvändbar i en Capacitor-app.
 *
 *  - Rullande baslinje (EMA) av rummets nivå, inklusive appens eget brus.
 *  - Baslinjen "fryser" nästan helt när nivån är hög, så att långvarigt gråt
 *    inte äts upp av baslinjen.
 *  - Trigger kräver att nivån legat över baslinje + marginal under en
 *    sammanhängande period (filtrerar dörrar och enstaka gnyenden).
 *  - Cooldown efter varje trigger så att sensorn inte fladdrar.
 */

export interface TriggerOptions {
  /** dB över baslinjen som krävs */
  marginDb: number;
  /** hur länge nivån måste vara förhöjd (ms) */
  sustainMs: number;
  /** andel av fönstret som måste ligga över tröskeln */
  overRatio: number;
  /** minsta tid mellan triggrar (ms) */
  cooldownMs: number;
  /** EMA-tidskonstant för baslinjen (ms) */
  baselineTauMs: number;
}

export const DEFAULT_TRIGGER_OPTIONS: TriggerOptions = {
  marginDb: 10,
  sustainMs: 2500,
  overRatio: 0.75,
  cooldownMs: 45_000,
  baselineTauMs: 30_000,
};

export type Sensitivity = "lag" | "mellan" | "hog";

export function optionsForSensitivity(s: Sensitivity): TriggerOptions {
  const margin = s === "hog" ? 7 : s === "mellan" ? 10 : 14;
  return { ...DEFAULT_TRIGGER_OPTIONS, marginDb: margin };
}

export interface TriggerResult {
  triggered: boolean;
  over: boolean;
  baselineDb: number;
  thresholdDb: number;
}

export class TriggerLogic {
  private opts: TriggerOptions;
  private baseline: number | null = null;
  private lastT: number | null = null;
  private window: { t: number; over: boolean }[] = [];
  private lastTriggerAt = -Infinity;

  constructor(opts: Partial<TriggerOptions> = {}) {
    this.opts = { ...DEFAULT_TRIGGER_OPTIONS, ...opts };
  }

  /** Sätt baslinjen direkt (efter kalibrering eller när uppspelning ändras). */
  seedBaseline(db: number): void {
    this.baseline = db;
    this.window = [];
    this.lastT = null;
  }

  get baselineDb(): number | null {
    return this.baseline;
  }

  push(t: number, db: number): TriggerResult {
    if (this.baseline === null) this.baseline = db;
    const threshold = this.baseline + this.opts.marginDb;
    const over = db > threshold;

    // Uppdatera baslinjen. Nästan fryst när nivån är förhöjd.
    if (this.lastT !== null) {
      const dt = Math.max(0, t - this.lastT);
      let alpha = 1 - Math.exp(-dt / this.opts.baselineTauMs);
      if (over) alpha *= 0.03;
      this.baseline += alpha * (db - this.baseline);
    }
    this.lastT = t;

    // Rullande fönster för sustained-kravet.
    this.window.push({ t, over });
    const cutoff = t - this.opts.sustainMs;
    while (this.window.length > 0 && this.window[0].t < cutoff) this.window.shift();

    let triggered = false;
    if (t - this.lastTriggerAt >= this.opts.cooldownMs && over && this.window.length >= 4) {
      const span = t - this.window[0].t;
      if (span >= this.opts.sustainMs * 0.9) {
        const overCount = this.window.reduce((acc, w) => acc + (w.over ? 1 : 0), 0);
        if (overCount / this.window.length >= this.opts.overRatio) {
          triggered = true;
          this.lastTriggerAt = t;
          this.window = [];
        }
      }
    }

    return { triggered, over, baselineDb: this.baseline, thresholdDb: threshold };
  }
}

/** Medelvärde i dB-domän, används av kalibreringen. */
export function meanDb(values: number[]): number {
  if (values.length === 0) return -60;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
