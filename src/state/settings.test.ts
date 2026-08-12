import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type StorageLike } from "./settings";

function minnesLagring(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("inställningar", () => {
  it("ger standardvärden utan lagring", () => {
    const s = loadSettings(null);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("sparar och läser tillbaka", () => {
    const lagring = minnesLagring();
    const s = loadSettings(lagring);
    s.soundId = "brunt";
    s.volume = 0.3;
    s.timerMin = 45;
    s.presets.push({
      namn: "Nattning",
      soundId: "rosa",
      volume: 0.5,
      mixOn: true,
      mixSoundId: "hjartslag",
      mixVolume: 0.4,
      timerMin: 0,
    });
    saveSettings(s, lagring);
    const s2 = loadSettings(lagring);
    expect(s2.soundId).toBe("brunt");
    expect(s2.volume).toBe(0.3);
    expect(s2.timerMin).toBe(45);
    expect(s2.presets).toHaveLength(1);
    expect(s2.presets[0].namn).toBe("Nattning");
  });

  it("fyller i saknade fält från äldre versioner", () => {
    const lagring = minnesLagring();
    lagring.setItem("nattljud:settings:v1", JSON.stringify({ soundId: "vitt" }));
    const s = loadSettings(lagring);
    expect(s.soundId).toBe("vitt");
    expect(s.guard).toEqual(DEFAULT_SETTINGS.guard);
    expect(s.fadeOutMin).toBe(DEFAULT_SETTINGS.fadeOutMin);
  });

  it("fyller i nya vaktfält i äldre sparade guard-objekt", () => {
    const lagring = minnesLagring();
    lagring.setItem(
      "nattljud:settings:v1",
      JSON.stringify({ guard: { sensitivity: "hog", playMin: 15, raiseInstead: true } }),
    );
    const s = loadSettings(lagring);
    expect(s.guard.sensitivity).toBe("hog");
    expect(s.guard.playMin).toBe(15);
    expect(s.guard.soundId).toBe(DEFAULT_SETTINGS.guard.soundId);
    expect(s.guard.volume).toBe(DEFAULT_SETTINGS.guard.volume);
  });

  it("överlever trasig JSON", () => {
    const lagring = minnesLagring();
    lagring.setItem("nattljud:settings:v1", "{trasigt");
    expect(loadSettings(lagring)).toEqual(DEFAULT_SETTINGS);
  });
});
