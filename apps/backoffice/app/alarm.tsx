"use client";
import { useEffect, useRef, useState } from "react";

/** Clés des alertes qui méritent l'alarme : course à risque (sans chauffeur, prise en charge proche), sans chauffeur après tous les tours, vol annulé. */
export const alarmKeys = (alerts: { reason: string; rideId: string }[]) =>
  alerts.filter((a) => a.reason === "NO_DRIVER" || a.reason === "AT_RISK" || a.reason === "FLIGHT_CANCELLED" || a.reason === "URGENT_INCIDENT").map((a) => `${a.reason}:${a.rideId}`);

const KEY = "clicab_alarme_coupee";

/**
 * Alarme de la tour de contrôle : sonne quand une nouvelle course est en souffrance (ou un vol annulé). Une alerte ne sonne qu'une fois ;
 * celles déjà présentes à l'ouverture sonnent une fois, pour ne pas passer inaperçues. Le choix « coupée » est retenu par le navigateur.
 * Les navigateurs n'autorisent le son qu'après une première action sur la page (la connexion suffit).
 */
/** null : le son joue ; « blocked » : le navigateur attend un clic ; « missing » : fichier absent ou illisible (cause différente, message différent). */
export type SoundProblem = null | "blocked" | "missing";
export const soundProblem = (e: unknown): Exclude<SoundProblem, null> => ((e as any)?.name === "NotAllowedError" ? "blocked" : "missing");
function play(set: (p: SoundProblem) => void) {
  new Audio("/sounds/alarme.mp3").play().then(() => set(null)).catch((e) => set(soundProblem(e)));
}

export function useAlarm(alerts: { reason: string; rideId: string }[] | null, enabled: boolean) {
  const seen = useRef(new Set<string>());
  const [muted, setMuted] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState<SoundProblem>(null);
  useEffect(() => { try { setMuted(localStorage.getItem(KEY) === "1"); } catch { setMuted(false); } }, []);
  useEffect(() => {
    if (!enabled) { seen.current.clear(); return; }
    if (!alerts || muted === null) return;
    const keys = alarmKeys(alerts);
    const fresh = keys.filter((k) => !seen.current.has(k));
    keys.forEach((k) => seen.current.add(k));
    if (fresh.length && !muted) play(setBlocked);
  }, [alerts, enabled, muted]);
  const toggle = () => setMuted((m) => { try { localStorage.setItem(KEY, m ? "0" : "1"); } catch { /* sans incidence */ } return !m; });
  const test = () => play(setBlocked);
  return { muted: muted === true, toggle, test, blocked };
}

export function AlarmButton({ alarm }: { alarm: ReturnType<typeof useAlarm> }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className={`btn ${alarm.muted ? "" : "primary"}`} onClick={alarm.toggle} title="Alarme de la tour de contrôle">
        {alarm.muted ? "🔕 Alarme coupée" : "🔔 Alarme"}
      </button>
      {!alarm.muted && <button className="btn" onClick={alarm.test} title="Écouter l'alarme">Tester</button>}
      {alarm.blocked && !alarm.muted && <span className="muted" style={{ fontSize: 12 }}>{alarm.blocked === "blocked" ? "Le navigateur bloque le son : cliquez sur « Tester »" : "Son de l'alarme introuvable ou illisible : prévenez l'équipe technique"}</span>}
    </span>
  );
}
