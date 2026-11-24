"use client";
import { useCallback, useEffect, useState } from "react";
import { adminBlobUrl, api, dt } from "../lib/api";

/** Points de rendez-vous proposés par les chauffeurs : l'équipe vérifie la photo, corrige le libellé, puis valide ou refuse. */
function Point({ p, onDone }: { p: any; onDone: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [label, setLabel] = useState(p.label);
  const [note, setNote] = useState(p.note ?? "");
  const [err, setErr] = useState("");
  useEffect(() => { adminBlobUrl(p.photo).then(setImg).catch(() => setImg(null)); }, [p.photo]);
  async function review(status: "APPROVED" | "REJECTED") {
    try { await api(`/admin/meeting-points/${p.id}/review`, { status, label: label.trim(), note: note.trim() || null }); setErr(""); onDone(); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
        {img ? <a href={img} target="_blank" rel="noreferrer"><img src={img} alt={p.label} style={{ width: 150, height: 200, objectFit: "cover", border: "2.5px solid var(--ink)", borderRadius: 12 }} /></a>
          : <div style={{ width: 150, height: 200, border: "2.5px dashed var(--ink)", borderRadius: 12 }} />}
        <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className={`chip ${p.status === "APPROVED" ? "ok" : p.status === "REJECTED" ? "bad" : ""}`} style={{ alignSelf: "flex-start" }}>
            {p.status === "APPROVED" ? "Validé" : p.status === "REJECTED" ? "Refusé" : "À vérifier"}
          </span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Libellé" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Indication pour le voyageur (facultatif)" aria-label="Indication" />
          <div className="muted" style={{ fontSize: 13 }}>
            Proposé le {dt(p.createdAt)} · {p.lat.toFixed(5)}, {p.lng.toFixed(5)}{p.accuracyM != null ? ` (±${Math.round(p.accuracyM)} m)` : ""} ·{" "}
            <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">voir sur une carte</a>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row">
            {p.status !== "APPROVED" && <button className="btn primary" disabled={label.trim().length < 3} onClick={() => review("APPROVED")}>Valider</button>}
            {p.status !== "REJECTED" && <button className="btn danger" onClick={() => review("REJECTED")}>{p.status === "APPROVED" ? "Retirer" : "Refuser"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MeetingPoints() {
  const [status, setStatus] = useState("PENDING");
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setList(await api<any[]>(`/admin/meeting-points?status=${status}`)); setErr(""); } catch (e: any) { setErr(e.message); } }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1 className="title">Points de rendez-vous</h1>
      <div className="muted" style={{ marginBottom: 12, color: "var(--on-sky)" }}>
        Photos prises par les chauffeurs à l'endroit exact où ils attendent. Une fois validée, la photo apparaît sur le lien de suivi des voyageurs dont la prise en charge est proche.
      </div>
      <div className="tabs2">
        {([["PENDING", "À vérifier"], ["APPROVED", "Validés"], ["REJECTED", "Refusés"]] as const).map(([k, l]) => (
          <button key={k} className={`btn ${status === k ? "primary" : ""}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      {err && <div className="card redbg">{err}</div>}
      {list?.map((p) => <Point key={p.id} p={p} onDone={load} />)}
      {list && !list.length && <div className="card">Rien ici.</div>}
    </>
  );
}
