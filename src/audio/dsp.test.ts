import { describe, expect, it } from "vitest";
import {
  PEAK_CEILING,
  TARGET_RMS_DB,
  bakeSeamlessLoop,
  normalizeLoudness,
  normalizePeak,
} from "./loop";
import { SOUNDS, renderSound } from "./sounds";
import { effectiveGain, fadeMult, sliderToGain } from "./volume";
import { encodeWav16Mono } from "./wav";

describe("wav-kodaren", () => {
  it("skriver korrekt header och data", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = encodeWav16Mono(samples, 44100);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 10);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(44100); // samplerate
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint16(34, true)).toBe(16); // bitar
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(16384); // round(0.5 · 32767)
    expect(v.getInt16(50, true)).toBe(0x7fff); // 1.0
    expect(v.getInt16(52, true)).toBe(-0x8000); // -1.0
  });

  it("klipper värden utanför [-1, 1]", () => {
    const buf = encodeWav16Mono(new Float32Array([2, -2]), 44100);
    const v = new DataView(buf);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x8000);
  });
});

describe("sömlös loop", () => {
  it("gör loopskarven kontinuerlig", () => {
    // Linjär ramp: utan bakning skulle skarven hoppa från ~1 till 0.
    const N = 1000;
    const F = 100;
    const rendered = new Float32Array(N + F);
    for (let i = 0; i < N + F; i++) rendered[i] = i / (N + F);
    const loop = bakeSeamlessLoop(rendered, N, F);
    expect(loop.length).toBe(N);
    // Steget över skarven (sista → första sample) ska vara i samma
    // storleksordning som ett vanligt sample-steg, inte ett hopp.
    const vanligtSteg = Math.abs(loop[501] - loop[500]);
    const skarvSteg = Math.abs(loop[0] - loop[N - 1]);
    expect(skarvSteg).toBeLessThan(vanligtSteg * 3 + 1e-6);
  });

  it("normalizePeak träffar målnivån", () => {
    const buf = new Float32Array([0.1, -0.2, 0.05]);
    normalizePeak(buf, 0.89);
    expect(Math.max(...buf.map(Math.abs))).toBeCloseTo(0.89, 5);
  });
});

describe("loudness-normalisering", () => {
  it("träffar mål-RMS när limitern inte behöver bita", () => {
    // Lågcrest-signal (sinus) hamnar helt under knät → exakt mål-RMS.
    const n = 8000;
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = 0.05 * Math.sin((2 * Math.PI * 50 * i) / n);
    normalizeLoudness(buf);
    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i];
    const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / n));
    expect(rmsDb).toBeCloseTo(TARGET_RMS_DB, 1);
  });

  it("håller |ut| under taket även vid extrem crest", () => {
    const buf = new Float32Array(1000).fill(0.001);
    buf[500] = 1; // ensam spik tvingar fram kraftig uppskalning + limitering
    normalizeLoudness(buf);
    let peak = 0;
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(PEAK_CEILING + 1e-6);
    // Signalen under knät är fortfarande linjärt skalad (samma inbördes form).
    expect(buf[0]).toBeCloseTo(buf[1], 10);
    expect(buf[0]).toBeGreaterThan(0.001);
  });
});

describe("volymkurvor", () => {
  it("sliderToGain är monoton med rätt ändpunkter", () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(1)).toBe(1);
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = sliderToGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    // Låga volymer ska vara finupplösta: halva reglaget ≈ -12 dB.
    expect(sliderToGain(0.5)).toBeCloseTo(0.25, 3);
  });

  it("fadeMult är 0 vid 0, 1 vid 1 och monoton", () => {
    expect(fadeMult(0)).toBe(0);
    expect(fadeMult(1)).toBe(1);
    let prev = -1;
    for (let m = 0; m <= 1.0001; m += 0.05) {
      const g = fadeMult(m);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it("effectiveGain kombinerar reglage, maxvolym och fade", () => {
    expect(effectiveGain(1, 1, 1)).toBe(1);
    expect(effectiveGain(1, 0.5, 1)).toBeCloseTo(0.25, 5);
    expect(effectiveGain(1, 1, 0)).toBe(0);
  });
});

describe("ljudrendering", () => {
  // Låg samplerate i testerna – samma kodväg, mycket snabbare.
  const SR_TEST = 8000;

  for (const def of SOUNDS) {
    it(`${def.id} renderar en giltig, normaliserad loop`, () => {
      const buf = renderSound(def.id, SR_TEST);
      expect(buf.length).toBeGreaterThan(SR_TEST * 20); // minst 20 s
      expect(buf.length).toBeLessThan(SR_TEST * 60); // under 1 min
      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = buf[i];
        expect(Number.isNaN(s)).toBe(false);
        const a = Math.abs(s);
        if (a > peak) peak = a;
        sumSq += s * s;
      }
      expect(peak).toBeLessThanOrEqual(PEAK_CEILING + 1e-4);
      expect(peak).toBeGreaterThan(0.5); // hörbart material, inte tyst
      // Loudness-normaliserad: nära mål-RMS (limitern äter som mest ~1 dB).
      const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / buf.length));
      expect(rmsDb).toBeGreaterThan(TARGET_RMS_DB - 2);
      expect(rmsDb).toBeLessThan(TARGET_RMS_DB + 0.5);
    });
  }

  it("vitt brus är deterministiskt (samma frö → samma fil)", () => {
    const a = renderSound("vitt", SR_TEST);
    const b = renderSound("vitt", SR_TEST);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < 1000; i++) expect(a[i]).toBe(b[i]);
  });
});
