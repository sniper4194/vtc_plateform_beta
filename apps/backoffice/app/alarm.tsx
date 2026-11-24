"use client";
import { useEffect, useRef, useState } from "react";

/** Clés des alertes qui méritent l'alarme : course sans chauffeur après tous les tours (en souffrance), vol annulé. */
export const alarmKeys = (alerts: { reason: string; rideId: string }[]) =>
  alerts.filter((a) => a.reason === "NO_DRIVER" || a.reason === "FLIGHT_CANCELLED").map((a) => `${a.reason}:${a.rideId}`);

const KEY = "clicab_alarme_coupee";

/**
 * Alarme de la tour de contrôle : sonne quand une nouvelle course est en souffrance (ou un vol annulé). Une alerte ne sonne qu'une fois ;
 * celles déjà présentes à l'ouverture sonnent une fois, pour ne pas passer inaperçues. Le choix « coupée » est retenu par le navigateur.
 * Les navigateurs n'autorisent le son qu'après une première action sur la page (la connexion suffit).
 */
export function useAlarm(alerts: { reason: string; rideId: string }[] | null, enabled: boolean) {
  const seen = useRef(new Set<string>());
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { try { setMuted(localStorage.getItem(KEY) === "1"); } catch { /* stockage indisponible : alarme active */ } }, []);
  useEffect(() => {
    if (!enabled || !alerts) return;
    const keys = alarmKeys(alerts);
    const fresh = keys.filter((k) => !seen.current.has(k));
    keys.forEach((k) => seen.current.add(k));
    if (fresh.length && !muted) new Audio("/sounds/alarme.mp3").play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  }, [alerts, enabled, muted]);
  const toggle = () => setMuted((m) => { try { localStorage.setItem(KEY, m ? "0" : "1"); } catch { /* sans incidence */ } return !m; });
  const test = () => new Audio("/sounds/alarme.mp3").play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  return { muted, toggle, test, blocked };
}

export function AlarmButton({ alarm }: { alarm: ReturnType<typeof useAlarm> }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className={`btn ${alarm.muted ? "" : "primary"}`} onClick={alarm.toggle} title="Alarme des courses en souffrance">
        {alarm.muted ? "🔕 Alarme coupée" : "🔔 Alarme"}
      </button>
      {!alarm.muted && <button className="btn" onClick={alarm.test} title="Écouter l'alarme">Tester</button>}
      {alarm.blocked && !alarm.muted && <span className="muted" style={{ fontSize: 12 }}>Le navigateur bloque le son : cliquez sur « Tester »</span>}
    </span>
  );
}
