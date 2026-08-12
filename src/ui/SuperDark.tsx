/**
 * Supermörk vy medan ljudet spelar: nästan helt svart skärm med bara en
 * diskret pausknapp, återstående tid och ljudnamn. Tryck någonstans för att
 * komma tillbaka till kontrollerna.
 */
import { fmtRemaining } from "./format";
import { PauseIcon } from "./icons";

interface Props {
  ljudNamn: string;
  remainingMs: number | null;
  onVakna: () => void;
  onPaus: () => void;
}

export function SuperDark({ ljudNamn, remainingMs, onVakna, onPaus }: Props) {
  return (
    <div
      className="superdark"
      onClick={onVakna}
      role="button"
      aria-label="Visa kontroller"
    >
      <div className="superdark-info">
        <div className="superdark-ljud">{ljudNamn}</div>
        <div className="superdark-timer">
          {remainingMs !== null ? fmtRemaining(remainingMs) + " kvar" : "spelar hela natten"}
        </div>
      </div>
      <button
        className="superdark-paus"
        aria-label="Pausa"
        onClick={(e) => {
          e.stopPropagation();
          onPaus();
        }}
      >
        <PauseIcon size={26} />
      </button>
      <div className="superdark-hint">tryck på skärmen för kontroller</div>
    </div>
  );
}
