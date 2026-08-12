import { useState } from "react";
import { getSound } from "../audio/sounds";
import type { Preset } from "../state/settings";
import { CrossIcon, PlusIcon } from "./icons";

interface Props {
  presets: Preset[];
  onAnvänd: (p: Preset) => void;
  onSpara: (namn: string) => void;
  onTaBort: (index: number) => void;
}

export function Presets({ presets, onAnvänd, onSpara, onTaBort }: Props) {
  const [sparaÖppen, setSparaÖppen] = useState(false);
  const [namn, setNamn] = useState("");

  return (
    <div className="presets">
      <div className="chips">
        {presets.map((p, i) => (
          <span key={`${p.namn}-${i}`} className="chip preset-chip">
            <button
              className="preset-anvand"
              onClick={() => onAnvänd(p)}
              title={`${getSound(p.soundId).namn}, ${p.timerMin === 0 ? "hela natten" : `${p.timerMin} min`}`}
            >
              {p.namn}
            </button>
            <button
              className="preset-ta-bort"
              aria-label={`Ta bort ${p.namn}`}
              onClick={() => {
                if (window.confirm(`Ta bort "${p.namn}"?`)) onTaBort(i);
              }}
            >
              <CrossIcon size={12} />
            </button>
          </span>
        ))}
        <button className="chip chip-ghost" onClick={() => setSparaÖppen(true)}>
          <PlusIcon size={14} /> Spara läge
        </button>
      </div>
      {sparaÖppen && (
        <div className="dialog-bak" onClick={() => setSparaÖppen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Spara nuvarande läge</h3>
            <p className="dim">Ljud, volym, mix och timer sparas som en favorit.</p>
            <input
              autoFocus
              placeholder="t.ex. Nattning"
              value={namn}
              maxLength={24}
              onChange={(e) => setNamn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && namn.trim()) {
                  onSpara(namn.trim());
                  setNamn("");
                  setSparaÖppen(false);
                }
              }}
            />
            <div className="dialog-knappar">
              <button className="knapp sekundar" onClick={() => setSparaÖppen(false)}>
                Avbryt
              </button>
              <button
                className="knapp"
                disabled={!namn.trim()}
                onClick={() => {
                  onSpara(namn.trim());
                  setNamn("");
                  setSparaÖppen(false);
                }}
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
