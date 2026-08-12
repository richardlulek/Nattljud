const VAL: { min: number; label: string }[] = [
  { min: 15, label: "15" },
  { min: 30, label: "30" },
  { min: 45, label: "45" },
  { min: 60, label: "60" },
  { min: 90, label: "90" },
  { min: 0, label: "Natt" },
];

interface Props {
  vald: number;
  onVälj: (min: number) => void;
}

export function TimerChips({ vald, onVälj }: Props) {
  return (
    <div className="chips" role="radiogroup" aria-label="Insomningstimer (minuter)">
      {VAL.map((v) => (
        <button
          key={v.min}
          role="radio"
          aria-checked={vald === v.min}
          className={`chip${vald === v.min ? " vald" : ""}`}
          onClick={() => onVälj(v.min)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
