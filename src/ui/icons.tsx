/**
 * Små inline-SVG:er (stroke = currentColor) – inga ikonbibliotek, ingen
 * extern laddning.
 */
import type { SoundId } from "../audio/sounds";

interface P {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function PlayIcon({ size = 34 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon({ size = 34 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MoonIcon({ size = 22 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function GearIcon({ size = 22 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
    </svg>
  );
}

export function ShieldIcon({ size = 22 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l7 2.6v5.2c0 4.6-3 8.1-7 9.9-4-1.8-7-5.3-7-9.9V5.6z" />
      <path d="M9.2 12.2l2 2 3.6-4" />
    </svg>
  );
}

export function BackIcon({ size = 22 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function CrossIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PlusIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SoundIcon({ id, size = 26 }: { id: SoundId; size?: number }) {
  const b = base(size);
  switch (id) {
    case "vitt":
      return (
        <svg {...b}>
          <path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" />
        </svg>
      );
    case "rosa":
      return (
        <svg {...b}>
          <path d="M3 13c2-4 4-4 6-1s4 3 6-1 4-3 6 0" />
          <path d="M3 17.5c3-2 5-2 9 0s6 2 9 0" opacity="0.55" />
        </svg>
      );
    case "brunt":
      return (
        <svg {...b}>
          <path d="M3 14c3-6 6-6 9 0s6 6 9 0" />
        </svg>
      );
    case "hjartslag":
      return (
        <svg {...b}>
          <path d="M12 20s-7-4.5-8.6-9A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.6 4c-.4 1.2-1.2 2.4-2.2 3.5" />
          <path d="M4.5 13h4l1.5-2.5 2 4 1.5-2.5h6" />
        </svg>
      );
    case "regn":
      return (
        <svg {...b}>
          <path d="M6.5 11a5 5 0 0 1 9.6-1.8A3.6 3.6 0 0 1 17 16H7a3 3 0 0 1-.5-5z" />
          <path d="M8.5 18.5l-.9 2M12.5 18.5l-.9 2M16.3 18.5l-.9 2" />
        </svg>
      );
    case "hartork":
      return (
        <svg {...b}>
          <path d="M4 7.5A3.5 3.5 0 0 1 7.5 4h5a5.5 5.5 0 0 1 0 11l-1.6 5a1.4 1.4 0 0 1-2.7-.8l1-4.2H7.5A3.5 3.5 0 0 1 4 11.5z" />
          <circle cx="12" cy="9.5" r="1.6" />
          <path d="M19.5 8h2M19.5 11h2" opacity="0.6" />
        </svg>
      );
    case "vagor":
      return (
        <svg {...b}>
          <path d="M3 10c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 1.7-1.2 3-1.8" />
          <path d="M3 15.5c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 1.7-1.2 3-1.8" opacity="0.55" />
        </svg>
      );
    case "hyssj":
      return (
        <svg {...b}>
          <path d="M12 4.5v11" />
          <path d="M12 15.5a2.6 2.6 0 1 1-2.6 2.6" />
          <path d="M15.5 6.5c1.6 1.4 1.6 3.6 0 5M18.3 4.8c2.6 2.4 2.6 6 0 8.4" opacity="0.55" />
        </svg>
      );
  }
}
