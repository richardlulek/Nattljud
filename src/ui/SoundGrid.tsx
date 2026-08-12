import { SOUNDS, type SoundId } from "../audio/sounds";
import { SoundIcon } from "./icons";

interface Props {
  vald: SoundId;
  onVälj: (id: SoundId) => void;
  /** kompakt variant för mixval */
  kompakt?: boolean;
  exkludera?: SoundId;
}

export function SoundGrid({ vald, onVälj, kompakt, exkludera }: Props) {
  return (
    <div className={kompakt ? "soundgrid kompakt" : "soundgrid"} role="listbox" aria-label="Välj ljud">
      {SOUNDS.filter((s) => s.id !== exkludera).map((s) => (
        <button
          key={s.id}
          role="option"
          aria-selected={vald === s.id}
          className={`soundtile${vald === s.id ? " vald" : ""}`}
          onClick={() => onVälj(s.id)}
        >
          <SoundIcon id={s.id} size={kompakt ? 20 : 26} />
          <span className="soundtile-namn">{s.namn}</span>
          {!kompakt && <span className="soundtile-desc">{s.beskrivning}</span>}
        </button>
      ))}
    </div>
  );
}
