/**
 * Vaktläge ("skriksensor"): telefonen ligger framme med skärmen på och
 * lyssnar efter gråt. Kräver uttrycklig aktivering. Mikrofonen används enbart
 * för nivåmätning i realtid – inget spelas in eller lagras.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { engine, type EngineState } from "../audio/engine";
import { getSound } from "../audio/sounds";
import { MicMonitor } from "../detect/micMonitor";
import {
  meanDb,
  optionsForSensitivity,
  TriggerLogic,
  type Sensitivity,
} from "../detect/triggerLogic";
import { WakeLockKeeper } from "../detect/wakeLock";
import { appendLog, clearLog, fmtTime, loadLog, type LogEntry } from "../state/guardLog";
import type { GuardSettings, Settings } from "../state/settings";
import { fmtRemaining } from "./format";
import { BackIcon } from "./icons";
import { SoundGrid } from "./SoundGrid";
import { VolumeSlider } from "./VolumeSlider";

interface Props {
  settings: Settings;
  engineState: EngineState;
  onUpdateGuard: (g: GuardSettings) => void;
  onExit: () => void;
}

type Fas = "intro" | "kalibrerar" | "armerad";

const KÄNSLIGHETER: { id: Sensitivity; label: string }[] = [
  { id: "lag", label: "Låg" },
  { id: "mellan", label: "Mellan" },
  { id: "hog", label: "Hög" },
];

const SPELTIDER = [10, 15, 20, 30, 45];

export function GuardView({ settings, engineState, onUpdateGuard, onExit }: Props) {
  const [fas, setFas] = useState<Fas>("intro");
  const [nivåDb, setNivåDb] = useState(-90);
  const [tröskelDb, setTröskelDb] = useState<number | null>(null);
  const [kalibProc, setKalibProc] = useState(0);
  const [fel, setFel] = useState<string | null>(null);
  const [wakeOk, setWakeOk] = useState<boolean | null>(null);
  const [logg, setLogg] = useState<LogEntry[]>(loadLog);
  const [spelarTill, setSpelarTill] = useState<number | null>(null);

  const monitorRef = useRef<MicMonitor | null>(null);
  const logicRef = useRef<TriggerLogic | null>(null);
  const wakeRef = useRef<WakeLockKeeper | null>(null);
  const intervalRef = useRef<number | null>(null);
  const reseedRef = useRef<number | null>(null);
  const spelarTillRef = useRef<number | null>(null);
  const boostedRef = useRef(false);
  const guardStartedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const pushLogg = useCallback((text: string) => {
    setLogg((l) => appendLog(l, text));
  }, []);

  const scheduleReseed = useCallback((ms: number) => {
    if (reseedRef.current !== null) window.clearTimeout(reseedRef.current);
    reseedRef.current = window.setTimeout(() => {
      reseedRef.current = null;
      const mon = monitorRef.current;
      if (mon?.active && logicRef.current) {
        logicRef.current.seedBaseline(mon.readDb());
      }
    }, ms);
  }, []);

  const stoppaAllt = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (reseedRef.current !== null) window.clearTimeout(reseedRef.current);
    reseedRef.current = null;
    monitorRef.current?.stop();
    monitorRef.current = null;
    wakeRef.current?.release();
    wakeRef.current = null;
    logicRef.current = null;
    if (boostedRef.current) {
      engine.setBoost(1);
      boostedRef.current = false;
    }
  }, []);

  useEffect(() => stoppaAllt, [stoppaAllt]);

  const onTrigger = useCallback(
    (now: number) => {
      const s = settingsRef.current;
      const st = engine.getState();
      const till = now + s.guard.playMin * 60_000;
      spelarTillRef.current = till;
      setSpelarTill(till);
      if (st.status === "playing" || st.status === "stopping") {
        if (s.guard.raiseInstead && !boostedRef.current) {
          engine.setBoost(1.7);
          boostedRef.current = true;
          pushLogg("Ljud upptäckt – höjer volymen");
        } else {
          pushLogg("Ljud upptäckt igen – förlänger speltiden");
        }
        scheduleReseed(6000);
      } else {
        // Vaktläget spelar sitt EGET valda ljud (guard.soundId/volume).
        engine.start({
          layers: [{ soundId: s.guard.soundId, volume: s.guard.volume }],
          fadeInMs: 4000,
          maxVol: s.maxVol,
          timerMin: 0, // vaktläget styr stoppet, inte insomningstimern
          fadeOutMs: s.fadeOutMin * 60_000,
        });
        guardStartedRef.current = true;
        pushLogg(
          `Ljud upptäckt – spelar ${getSound(s.guard.soundId).namn.toLowerCase()} i ${s.guard.playMin} min`,
        );
        scheduleReseed(9000);
      }
    },
    [pushLogg, scheduleReseed],
  );

  const aktivera = useCallback(async () => {
    // Klicket är en användargest: välsigna audio-elementen NU så att en
    // trigger mitt i natten får starta uppspelning programmatiskt.
    engine.bless();
    setFel(null);

    const monitor = new MicMonitor();
    try {
      await monitor.start();
    } catch {
      setFel(
        "Mikrofonåtkomst nekades. Vaktläget behöver mikrofonen för att mäta ljudnivån (inget spelas in). Tillåt mikrofon i webbläsarens inställningar och försök igen.",
      );
      return;
    }
    monitorRef.current = monitor;

    const wake = new WakeLockKeeper();
    wakeRef.current = wake;
    setWakeOk(await wake.acquire());

    setFas("kalibrerar");
    setKalibProc(0);
    const start = Date.now();
    const samples: number[] = [];
    let kalibrerar = true;

    intervalRef.current = window.setInterval(() => {
      const mon = monitorRef.current;
      if (!mon?.active) return;
      const db = mon.readDb();
      const now = Date.now();
      setNivåDb(db);

      if (kalibrerar) {
        samples.push(db);
        const p = Math.min(1, (now - start) / 10_000);
        setKalibProc(p);
        if (p >= 1) {
          kalibrerar = false;
          const logic = new TriggerLogic(
            optionsForSensitivity(settingsRef.current.guard.sensitivity),
          );
          const bas = meanDb(samples);
          logic.seedBaseline(bas);
          logicRef.current = logic;
          setFas("armerad");
          setLogg((l) => appendLog(l, `Vaktläge på (baslinje ${bas.toFixed(0)} dB)`));
        }
        return;
      }

      const logic = logicRef.current;
      if (!logic) return;
      const res = logic.push(now, db);
      setTröskelDb(res.thresholdDb);

      // Har den tysta perioden efter senaste triggern löpt ut?
      if (spelarTillRef.current !== null && now >= spelarTillRef.current) {
        spelarTillRef.current = null;
        setSpelarTill(null);
        const s = settingsRef.current;
        if (boostedRef.current) {
          engine.setBoost(1);
          boostedRef.current = false;
          setLogg((l) => appendLog(l, "Tyst igen – volymen åter normal"));
        } else if (guardStartedRef.current) {
          const st = engine.getState();
          if (st.status === "playing") {
            engine.stop(Math.min(s.fadeOutMin, 2) * 60_000);
            setLogg((l) =>
              appendLog(l, `Tyst i ${s.guard.playMin} min – tonar ut ljudet`),
            );
            scheduleReseed(Math.min(s.fadeOutMin, 2) * 60_000 + 4000);
          }
          guardStartedRef.current = false;
        }
      }

      if (res.triggered) onTrigger(now);
    }, 120);
  }, [onTrigger, scheduleReseed]);

  const avsluta = useCallback(() => {
    if (fas !== "intro") pushLogg("Vaktläge av");
    stoppaAllt();
    onExit();
  }, [fas, onExit, pushLogg, stoppaAllt]);

  /* ------------------------------------------------------------ render */

  if (fas === "intro") {
    return (
      <div className="vy vaktvy-intro">
        <header className="topprad">
          <button className="ikonknapp" onClick={onExit} aria-label="Tillbaka">
            <BackIcon />
          </button>
          <h2>Vaktläge</h2>
          <span className="topprad-spacer" />
        </header>

        <p>
          Telefonen ligger framme med <strong>skärmen på</strong> och lyssnar efter gråt.
          Hörs ihållande ljud i 2–3 sekunder tonas{" "}
          {getSound(settings.guard.soundId).namn.toLowerCase()} in automatiskt och spelar
          i {settings.guard.playMin} min.
        </p>

        <section className="infosektion">
          <h3>Ljud vid trigger</h3>
          <SoundGrid
            kompakt
            vald={settings.guard.soundId}
            onVälj={(id) => onUpdateGuard({ ...settings.guard, soundId: id })}
          />
          <VolumeSlider
            label="Volym vid trigger"
            value={settings.guard.volume}
            onChange={(v) => onUpdateGuard({ ...settings.guard, volume: v })}
          />
          <label className="togglerad">
            <input
              type="checkbox"
              checked={settings.guard.raiseInstead}
              onChange={(e) =>
                onUpdateGuard({ ...settings.guard, raiseInstead: e.target.checked })
              }
            />
            <span>
              Höj volymen i stället för att starta från tyst
              <span className="dim"> (när ljudet redan spelar hela natten)</span>
            </span>
          </label>
        </section>

        <section className="infosektion">
          <h3>Lyssning</h3>
          <div className="faltgrupp">
            <span className="faltrubrik">Känslighet</span>
            <div className="chips">
              {KÄNSLIGHETER.map((k) => (
                <button
                  key={k.id}
                  className={`chip${settings.guard.sensitivity === k.id ? " vald" : ""}`}
                  onClick={() => onUpdateGuard({ ...settings.guard, sensitivity: k.id })}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div className="faltgrupp">
            <span className="faltrubrik">Speltid efter trigger</span>
            <div className="chips">
              {SPELTIDER.map((m) => (
                <button
                  key={m}
                  className={`chip${settings.guard.playMin === m ? " vald" : ""}`}
                  onClick={() => onUpdateGuard({ ...settings.guard, playMin: m })}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
        </section>

        <p className="dim liten">
          Integritet: mikrofonen mäter enbart ljud<em>nivån</em> i realtid – inget spelas
          in, sparas eller skickas. Skärmen hålls tänd (webbappar förlorar mikrofonen vid
          låst skärm), så lägg telefonen på laddning.
        </p>

        {fel && <p className="felruta">{fel}</p>}

        <button className="knapp stor" onClick={() => void aktivera()}>
          Aktivera vaktläge
        </button>

        {logg.length > 0 && (
          <div className="loggsektion">
            <div className="faltrubrik-rad">
              <span className="faltrubrik">Senaste natten</span>
              <button className="lank" onClick={() => setLogg(clearLog())}>
                Rensa
              </button>
            </div>
            <Logglista logg={logg} />
          </div>
        )}
      </div>
    );
  }

  const spelar = engineState.status === "playing" || engineState.status === "stopping";
  const meterPct = (db: number) => Math.min(100, Math.max(0, ((db + 80) / 70) * 100));

  return (
    <div className="vaktvy-svart">
      {fas === "kalibrerar" ? (
        <div className="vakt-status">
          <div className="vakt-dot kalibrerar" />
          <div className="vakt-text">Kalibrerar rummets ljudnivå …</div>
          <div className="kalibstapel">
            <div className="kalibstapel-fyll" style={{ width: `${kalibProc * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="vakt-status">
          <div className={`vakt-dot${spelar ? " spelar" : " lyssnar"}`} />
          <div className="vakt-text">
            {spelar
              ? spelarTill
                ? `Spelar – ${fmtRemaining(Math.max(0, spelarTill - Date.now()))} kvar`
                : "Spelar"
              : "Lyssnar efter gråt"}
          </div>
          <div className="nivametare" aria-hidden>
            <div className="nivametare-fyll" style={{ width: `${meterPct(nivåDb)}%` }} />
            {tröskelDb !== null && (
              <div className="nivametare-troskel" style={{ left: `${meterPct(tröskelDb)}%` }} />
            )}
          </div>
        </div>
      )}

      <Logglista logg={logg.slice(-6)} dov />

      <div className="vakt-fot">
        {wakeOk === false && (
          <p className="dim liten">
            ⚠︎ Kunde inte hålla skärmen tänd automatiskt – stäng av autolås i
            telefonens inställningar medan vaktläget används.
          </p>
        )}
        <p className="dim liten">🔌 Lägg telefonen på laddning – skärmen hålls tänd.</p>
        <p className="dim liten">Inget spelas in – endast ljudnivån mäts.</p>
        <button className="knapp sekundar stor" onClick={avsluta}>
          Stäng av vaktläget
        </button>
      </div>
    </div>
  );
}

function Logglista({ logg, dov }: { logg: LogEntry[]; dov?: boolean }) {
  if (logg.length === 0) return null;
  return (
    <ul className={`logglista${dov ? " dov" : ""}`}>
      {[...logg].reverse().map((e, i) => (
        <li key={`${e.t}-${i}`}>
          <span className="logg-tid">{fmtTime(e.t)}</span> {e.text}
        </li>
      ))}
    </ul>
  );
}
