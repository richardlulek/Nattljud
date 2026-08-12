/**
 * Vaktlägets statuslogg ("03:12 ljud detekterat, spelade 20 min"), så att
 * föräldern på morgonen kan se vad som hänt under natten.
 */
export interface LogEntry {
  t: number; // epoch ms
  text: string;
}

const KEY = "nattljud:guardlog:v1";
const MAX = 120;

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLog(entries: LogEntry[], text: string): LogEntry[] {
  const next = [...entries, { t: Date.now(), text }].slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignorera */
  }
  return next;
}

export function clearLog(): LogEntry[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorera */
  }
  return [];
}

export function fmtTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
