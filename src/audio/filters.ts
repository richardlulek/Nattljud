/**
 * Biquad-filter (RBJ Audio EQ Cookbook). Ren TS så att ljuden kan renderas
 * utan Web Audio och testas i Node.
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  processBuffer(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]);
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  static lowpass(sr: number, freq: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * freq) / sr;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const b1 = 1 - cs;
    return new Biquad().set(b1 / 2, b1, b1 / 2, 1 + alpha, -2 * cs, 1 - alpha);
  }

  static highpass(sr: number, freq: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * freq) / sr;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const b0 = (1 + cs) / 2;
    return new Biquad().set(b0, -(1 + cs), b0, 1 + alpha, -2 * cs, 1 - alpha);
  }

  static bandpass(sr: number, freq: number, q = 1): Biquad {
    const w = (2 * Math.PI * freq) / sr;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return new Biquad().set(alpha, 0, -alpha, 1 + alpha, -2 * cs, 1 - alpha);
  }

  static lowshelf(sr: number, freq: number, gainDb: number, s = 1): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w = (2 * Math.PI * freq) / sr;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = (sn / 2) * Math.sqrt((A + 1 / A) * (1 / s - 1) + 2);
    const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
    return new Biquad().set(
      A * (A + 1 - (A - 1) * cs + twoSqrtAalpha),
      2 * A * (A - 1 - (A + 1) * cs),
      A * (A + 1 - (A - 1) * cs - twoSqrtAalpha),
      A + 1 + (A - 1) * cs + twoSqrtAalpha,
      -2 * (A - 1 + (A + 1) * cs),
      A + 1 + (A - 1) * cs - twoSqrtAalpha,
    );
  }

  static highshelf(sr: number, freq: number, gainDb: number, s = 1): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w = (2 * Math.PI * freq) / sr;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = (sn / 2) * Math.sqrt((A + 1 / A) * (1 / s - 1) + 2);
    const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
    return new Biquad().set(
      A * (A + 1 + (A - 1) * cs + twoSqrtAalpha),
      -2 * A * (A - 1 + (A + 1) * cs),
      A * (A + 1 + (A - 1) * cs - twoSqrtAalpha),
      A + 1 - (A - 1) * cs + twoSqrtAalpha,
      2 * (A - 1 - (A + 1) * cs),
      A + 1 - (A - 1) * cs - twoSqrtAalpha,
    );
  }
}
