/**
 * Inställningar och persistens. Allt sparas lokalt i localStorage – ingen
 * backend, ingen tracking.
 */
import type { SoundId } from "../audio/sounds";
import type { Sensitivity } from "../detect/triggerLogic";

export interface Preset {
  namn: string;
  soundId: SoundId;
  volume: number;
  mixOn: boolean;
  mixSoundId: SoundId;
  mixVolume: number;
  timerMin: number;
}

export interface GuardSettings {
  sensitivity: Sensitivity;
  /** speltid efter trigger, minuter */
  playMin: number;
  /** höj volymen vid trigger i stället för att starta från tyst */
  raiseInstead: boolean;
}

export interface Settings {
  soundId: SoundId;
  volume: number;
  mixOn: boolean;
  mixSoundId: SoundId;
  mixVolume: number;
  /** minuter; 0 = hela natten */
  timerMin: number;
  fadeInSec: number;
  /** timerns fade-ut i minuter (2–5) */
  fadeOutMin: number;
  /** mjuk maxvolymspärr, 0.1–1 */
  maxVol: number;
  presets: Preset[];
  guard: GuardSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  soundId: "rosa",
  volume: 0.55,
  mixOn: false,
  mixSoundId: "hjartslag",
  mixVolume: 0.45,
  timerMin: 0,
  fadeInSec: 3,
  fadeOutMin: 3,
  maxVol: 1,
  presets: [],
  guard: { sensitivity: "mellan", playMin: 20, raiseInstead: false },
};

const KEY = "nattljud:settings:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    localStorage.setItem("nattljud:probe", "1");
    localStorage.removeItem("nattljud:probe");
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageLike | null = safeStorage()): Settings {
  const base: Settings = structuredClone
    ? structuredClone(DEFAULT_SETTINGS)
    : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!storage) return base;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...parsed,
      guard: { ...base.guard, ...(parsed.guard ?? {}) },
      presets: Array.isArray(parsed.presets) ? parsed.presets : [],
    };
  } catch {
    return base;
  }
}

export function saveSettings(
  s: Settings,
  storage: StorageLike | null = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* fullt/privat läge – ignorera */
  }
}
