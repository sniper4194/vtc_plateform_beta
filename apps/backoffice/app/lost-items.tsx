"use client";
import { useCallback, useEffect, useState } from "react";
import { api, dt } from "../lib/api";

const LABEL: Record<string, [string, string]> = {
  OPEN: ["Attente chauffeur", ""], FOUND: ["Trouvé : à restituer", "ok"], NOT_FOUND: ["Pas trouvé", "bad"], RETURNED: ["Rendu", "ok"], CLOSED: ["Clos", ""],
};

/**
 * Objets oubliés signalés par les voyageurs sur leur page de suivi. Le chauffeur répond depuis son application ;
 * l'équipe organise la restitution (coordonnées visibles ici seulement) puis clôt le signalement.
 */
export function LostItems() {
  const [filter, setFilter] = useState("open");
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { setList(await api<any[]>("/admin/lost-items")); setErr(""); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  async function close(id: string, status: "RETURNED" | "CLOSED") {
    try { await api(`/admin/lost-items/${id}/close`, { status }); load(); } catch (e: any) { setErr(e.message); }
  }
  const shown = (list ?? []).filter((l) => (filter === "open" ? ["OPEN", "FOUND", "NOT_FOUND"].includes(l.status) : !["OPEN", "FOUND", "NOT_FOUND"].includes(l.status)));
  return (
    <>
      <h1 className="title">Objets oubliés</h1>
      <div className="muted" style={{ marginBottom: 12, color: "var(--on-sky)" }}>
        Signalés par les voyageurs depuis leur lien de suivi. Le chauffeur répond dans son application. Les frais éventuels de restitution ne sont pas encore définis (à décider).
      </div>
      <div className="tabs2">
        {([["open", "En cours"], ["done", "Clos"]] as const).map(([k, l]) => (
          <button key={k} className={`btn ${filter === k ? "primary" : ""}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {err && <div className="card redbg">{err}</div>}
      {list && !shown.length && <div className="card muted">Aucun signalement {filter === "open" ? "en cours" : "clos"}.</div>}
      {shown.map((l) => {
        const [label, tone] = LABEL[l.status] ?? [l.status, ""];
        return (
          <div className="card" key={l.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 240, flex: 1 }}>
                <span className={`chip ${tone}`} style={{ alignSelf: "flex-start" }}>{label}</span>
                <b>R-{l.ref} · « {l.description} »</b>
                {l.driverNote && <div>Chauffeur : {l.driverNote}</div>}
                <div className="muted" style={{ fontSize: 13 }}>
                  Signalé le {dt(l.createdAt)}{l.answeredAt ? ` · réponse le ${dt(l.answeredAt)}` : ""}{l.closedAt ? ` · clos le ${dt(l.closedAt)} par ${l.closedBy}` : ""}
                </div>
                <div style={{ fontSize: 13 }}>
                  Voyageur : {l.passenger.name} · <a href={`tel:${l.passenger.phone}`}>{l.passenger.phone}</a>{l.passenger.email ? ` · ${l.passenger.email}` : ""}{l.partner ? ` · via ${l.partner}` : ""}
                </div>
                {l.driver && <div style={{ fontSize: 13 }}>Chauffeur : {l.driver.name} · <a href={`tel:${l.driver.phone}`}>{l.driver.phone}</a></div>}
              </div>
              {["OPEN", "FOUND", "NOT_FOUND"].includes(l.status) && (
                <div className="row">
                  {l.status === "FOUND" && <button className="btn primary" onClick={() => close(l.id, "RETURNED")}>Objet rendu</button>}
                  <button className="btn" onClick={() => close(l.id, "CLOSED")}>Clore</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
