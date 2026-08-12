/**
 * Ljudbibliotekets körtidslager: ser till att varje ljud finns som WAV-blob
 * (från IndexedDB eller nyrenderat) och som rå Float32Array när "bakad volym"
 * behövs (iPhone, där elementvolym inte går att styra från JS).
 */
import { cacheGet, cachePrune, cachePut } from "./blobCache";
import { GEN_VERSION, SOUNDS, SR, renderSound, type SoundId } from "./sounds";
import { wavBlob } from "./wav";

interface Entry {
  blob: Blob;
  url: string;
  /** Råsamples behålls bara för ljud som spelas i bakat volymläge. */
  samples: Float32Array | null;
}

const entries = new Map<SoundId, Entry>();
const pending = new Map<SoundId, Promise<Entry>>();

const keyFor = (id: SoundId) => `v${GEN_VERSION}:${id}`;

async function decodeToSamples(blob: Blob): Promise<Float32Array> {
  // WAV:en är vår egen 16-bit mono – avkoda direkt utan Web Audio.
  const buf = await blob.arrayBuffer();
  const v = new DataView(buf);
  const count = (buf.byteLength - 44) / 2;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = v.getInt16(44 + i * 2, true);
    out[i] = s / (s < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

async function build(id: SoundId, keepSamples: boolean): Promise<Entry> {
  const cached = await cacheGet(keyFor(id));
  if (cached) {
    const entry: Entry = {
      blob: cached,
      url: URL.createObjectURL(cached),
      samples: keepSamples ? await decodeToSamples(cached) : null,
    };
    return entry;
  }
  const samples = renderSound(id, SR);
  const blob = wavBlob(samples, SR);
  void cachePut(keyFor(id), blob);
  return { blob, url: URL.createObjectURL(blob), samples: keepSamples ? samples : null };
}

/** Hämta (och vid behov skapa) ett ljud. */
export function ensureSound(id: SoundId, opts?: { keepSamples?: boolean }): Promise<Entry> {
  const existing = entries.get(id);
  const keepSamples = opts?.keepSamples ?? false;
  if (existing && (!keepSamples || existing.samples)) return Promise.resolve(existing);
  const inflight = pending.get(id);
  if (inflight && !keepSamples) return inflight;

  const p = (async () => {
    if (existing && keepSamples && !existing.samples) {
      existing.samples = await decodeToSamples(existing.blob);
      return existing;
    }
    const entry = await build(id, keepSamples);
    entries.set(id, entry);
    return entry;
  })();
  pending.set(id, p);
  p.finally(() => {
    if (pending.get(id) === p) pending.delete(id);
  });
  return p;
}

/** Synkron träff om ljudet redan är klart (behövs i gest-kritiska vägar). */
export function getReady(id: SoundId): Entry | null {
  return entries.get(id) ?? null;
}

/** Släpp råsamples för ljud som inte längre spelas (sparar minne). */
export function releaseSamples(except: SoundId[]): void {
  for (const [id, entry] of entries) {
    if (!except.includes(id)) entry.samples = null;
  }
}

/**
 * Förgenerera alla ljud i tur och ordning med pauser emellan så att UI-tråden
 * inte blockeras. Körs i bakgrunden efter appstart.
 */
export async function pregenerateAll(first: SoundId[], onProgress?: (done: number, total: number) => void): Promise<void> {
  await cachePrune(`v${GEN_VERSION}:`);
  const order: SoundId[] = [
    ...first,
    ...SOUNDS.map((s) => s.id).filter((id) => !first.includes(id)),
  ];
  let done = 0;
  for (const id of order) {
    try {
      await ensureSound(id);
    } catch (e) {
      console.warn("Kunde inte generera", id, e);
    }
    done++;
    onProgress?.(done, order.length);
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Kort tyst wav som används för att "välsigna" audio-element i användargesten. */
let silentUrl: string | null = null;
export function getSilentUrl(): string {
  if (!silentUrl) {
    silentUrl = URL.createObjectURL(wavBlob(new Float32Array(Math.round(SR * 0.15)), SR));
  }
  return silentUrl;
}
