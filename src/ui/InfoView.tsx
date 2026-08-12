/**
 * Inställningar & info: fades, mjuk maxvolymspärr, säkerhetsinfo om ljudnivå,
 * installationshjälp och integritet.
 */
import { engine } from "../audio/engine";
import type { Settings } from "../state/settings";
import { BackIcon } from "./icons";

interface Props {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onExit: () => void;
}

const FADE_IN_VAL = [0, 2, 3, 5, 8];
const FADE_UT_VAL = [2, 3, 4, 5];

export function InfoView({ settings, onUpdate, onExit }: Props) {
  return (
    <div className="vy">
      <header className="topprad">
        <button className="ikonknapp" onClick={onExit} aria-label="Tillbaka">
          <BackIcon />
        </button>
        <h2>Inställningar &amp; info</h2>
        <span className="topprad-spacer" />
      </header>

      <section className="infosektion">
        <h3>Toning</h3>
        <div className="faltgrupp">
          <span className="faltrubrik">Fade-in vid start</span>
          <div className="chips">
            {FADE_IN_VAL.map((s) => (
              <button
                key={s}
                className={`chip${settings.fadeInSec === s ? " vald" : ""}`}
                onClick={() => onUpdate({ fadeInSec: s })}
              >
                {s === 0 ? "Av" : `${s} s`}
              </button>
            ))}
          </div>
        </div>
        <div className="faltgrupp">
          <span className="faltrubrik">Fade-ut när timern går ut</span>
          <div className="chips">
            {FADE_UT_VAL.map((m) => (
              <button
                key={m}
                className={`chip${settings.fadeOutMin === m ? " vald" : ""}`}
                onClick={() => onUpdate({ fadeOutMin: m })}
              >
                {m} min
              </button>
            ))}
          </div>
          <p className="dim liten">Ljudet tonas alltid ut gradvis – aldrig tvärstopp.</p>
        </div>
      </section>

      <section className="infosektion">
        <h3>Säker ljudnivå</h3>
        <p>
          Ställ enheten <strong>minst 2 meter</strong> från bebisen och rikta inte
          högtalaren mot sängen. Riktvärdet är max{" "}
          <strong>cirka 50&nbsp;dB vid barnets öra</strong> (ungefär som ett lugnt
          samtal). Använd lägsta volym som fungerar.
        </p>
        <div className="faltgrupp">
          <span className="faltrubrik">
            Mjuk maxvolymspärr: {Math.round(settings.maxVol * 100)}%
          </span>
          <input
            type="range"
            min={30}
            max={100}
            step={5}
            value={Math.round(settings.maxVol * 100)}
            onChange={(e) => onUpdate({ maxVol: Number(e.target.value) / 100 })}
            aria-label="Maxvolym"
          />
          <p className="dim liten">
            Begränsar hur högt volymreglaget kan spela – ett skydd mot trötta tummar
            mitt i natten.
          </p>
        </div>
        {engine.bakedMode && (
          <p className="dim liten">
            iPhone: webbläsaren låter inte appen styra mediavolymen direkt, så
            volymändringar tar någon sekund (ljudfilen räknas om). Snabbast är
            telefonens volymknappar.
          </p>
        )}
      </section>

      <section className="infosektion">
        <h3>Installera som app</h3>
        <p className="dim">
          Installerad från hemskärmen startar Nattljud i fullskärm och fungerar helt
          offline – även i flygplansläge.
        </p>
        <p>
          <strong>iPhone/iPad:</strong> öppna i Safari → Dela-knappen →{" "}
          <em>Lägg till på hemskärmen</em>.
        </p>
        <p>
          <strong>Android:</strong> Chrome-menyn (⋮) → <em>Lägg till på startskärmen</em>{" "}
          (eller "Installera app").
        </p>
      </section>

      <section className="infosektion">
        <h3>Integritet</h3>
        <p className="dim">
          Ingen inloggning, ingen tracking, inga externa anrop. Allt (även
          vaktlägets ljudnivåmätning) sker lokalt på din enhet. Ljuden genereras i
          appen och sparas i enhetens lokala lagring.
        </p>
      </section>

      <section className="infosektion">
        <h3>Teknik &amp; felsökning</h3>
        <p className="dim liten">
          Om ljudet skulle tystna när skärmen låses på just din enhet: testa den
          tekniska provsidan{" "}
          <a href="spike.html" target="_blank" rel="noreferrer">
            spike.html
          </a>{" "}
          som loggar exakt vad som händer, och läs README i projektet.
        </p>
        <p className="dim liten">Nattljud v1.2 · byggd utan backend · öppen källkod i repot nattljud</p>
      </section>
    </div>
  );
}
