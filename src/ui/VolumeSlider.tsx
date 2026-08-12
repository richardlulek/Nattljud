import type { CSSProperties } from "react";

interface Props {
  label: string;
  value: number; // 0..1
  onChange: (v: number) => void;
}

export function VolumeSlider({ label, value, onChange }: Props) {
  return (
    <label className="volym">
      <span className="volym-rad">
        <span>{label}</span>
        <span className="volym-varde">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={label}
        style={{ "--fyll": `${Math.round(value * 100)}%` } as CSSProperties}
      />
    </label>
  );
}
