import { describe, expect, it } from "vitest";
import { TriggerLogic, meanDb, optionsForSensitivity } from "./triggerLogic";

/** Mata logiken med en nivåsekvens i 100 ms-steg. Returnerar triggertider. */
function kör(
  logic: TriggerLogic,
  segment: { sek: number; db: number }[],
  startT = 0,
): number[] {
  const triggrar: number[] = [];
  let t = startT;
  for (const seg of segment) {
    const steg = Math.round((seg.sek * 1000) / 100);
    for (let i = 0; i < steg; i++) {
      t += 100;
      const res = logic.push(t, seg.db);
      if (res.triggered) triggrar.push(t);
    }
  }
  return triggrar;
}

describe("TriggerLogic", () => {
  it("triggar på ihållande gråt över baslinjen", () => {
    const logic = new TriggerLogic({ marginDb: 10, sustainMs: 2500 });
    logic.seedBaseline(-50);
    const triggrar = kör(logic, [
      { sek: 30, db: -50 }, // lugnt rum
      { sek: 5, db: -30 }, // gråt
    ]);
    expect(triggrar.length).toBe(1);
    // Trigger ska komma först efter sustained-perioden, inte direkt.
    expect(triggrar[0]).toBeGreaterThan(30_000 + 1_700);
    expect(triggrar[0]).toBeLessThan(30_000 + 4_000);
  });

  it("ignorerar korta ljud (dörrar, enstaka gnyenden)", () => {
    const logic = new TriggerLogic({ marginDb: 10, sustainMs: 2500 });
    logic.seedBaseline(-50);
    const triggrar = kör(logic, [
      { sek: 20, db: -50 },
      { sek: 1, db: -25 }, // kort smäll
      { sek: 20, db: -50 },
      { sek: 0.8, db: -20 },
      { sek: 10, db: -50 },
    ]);
    expect(triggrar.length).toBe(0);
  });

  it("respekterar cooldown mellan triggrar", () => {
    const logic = new TriggerLogic({ marginDb: 10, sustainMs: 2500, cooldownMs: 45_000 });
    logic.seedBaseline(-50);
    const triggrar = kör(logic, [
      { sek: 10, db: -50 },
      { sek: 20, db: -28 }, // långt gråt: bara EN trigger inom cooldown
      { sek: 40, db: -50 }, // tystnad tills cooldown löpt ut
      { sek: 6, db: -28 }, // nytt gråt efter cooldown → ny trigger
    ]);
    expect(triggrar.length).toBe(2);
    expect(triggrar[1] - triggrar[0]).toBeGreaterThanOrEqual(45_000);
  });

  it("baslinjen följer förändringar som ligger under marginalen", () => {
    const logic = new TriggerLogic({ marginDb: 10, baselineTauMs: 30_000 });
    logic.seedBaseline(-60);
    // Rummet blir gradvis lite högre (fläkt, element): +7 dB, under marginalen.
    kör(logic, [{ sek: 180, db: -53 }]);
    expect(logic.baselineDb).toBeGreaterThan(-54.5);
    expect(logic.baselineDb).toBeLessThan(-52);
    // En nivå strax över nya baslinjen (men under marginalen) triggar inte.
    const triggrar = kör(logic, [{ sek: 5, db: -50 }], 180_000);
    expect(triggrar.length).toBe(0);
  });

  it("baslinjen fryser nästan helt under pågående gråt", () => {
    const logic = new TriggerLogic({ marginDb: 10, baselineTauMs: 30_000, cooldownMs: 10_000 });
    logic.seedBaseline(-50);
    kör(logic, [{ sek: 60, db: -25 }]); // en minut gråt
    // Baslinjen får inte ha "ätit upp" gråten.
    expect(logic.baselineDb).toBeLessThan(-40);
  });

  it("känslighetslägena ger olika marginaler", () => {
    expect(optionsForSensitivity("hog").marginDb).toBeLessThan(
      optionsForSensitivity("mellan").marginDb,
    );
    expect(optionsForSensitivity("mellan").marginDb).toBeLessThan(
      optionsForSensitivity("lag").marginDb,
    );
  });

  it("meanDb hanterar tom lista", () => {
    expect(meanDb([])).toBe(-60);
    expect(meanDb([-40, -50])).toBe(-45);
  });
});
