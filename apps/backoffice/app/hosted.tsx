"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Pages de réservation clé en main : pour un hôtel ou une agence sans développeur. L'équipe saisit l'adresse du partenaire
 * et ses coordonnées GPS (clic droit sur le lieu dans une carte en ligne), éventuellement un code d'accès, puis active la page.
 */
function Editor({ p, onDone }: { p: any; onDone: () => void }) {
  const h = p.hosted;
  const [f, setF] = useState({
    enabled: h.enabled, slug: h.slug ?? p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
    placeLabel: h.placeLabel ?? p.name, address: h.address ?? "", gps: h.lat != null ? `${h.lat}, ${h.lng}` : "", code: "", removeCode: false,
  });
  const [msg, setMsg] = useState("");
  async function save(enabled: boolean) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(f.gps);
    if (!m) { setMsg("Coordonnées GPS au format « 48.8589, 2.3802 »"); return; }
    try {
      await api(`/admin/partners/${p.id}/hosted`, {
        enabled, slug: f.slug, placeLabel: f.placeLabel, address: f.address, lat: Number(m[1]), lng: Number(m[2]),
        ...(f.removeCode ? { accessCode: null } : f.code ? { accessCode: f.code } : {}),
      });
      setMsg(enabled ? "Page active" : "Page désactivée"); setF({ ...f, enabled, code: "", removeCode: false }); onDone();
    } catch (e: any) { setMsg(e.body?.errors ? Object.entries(e.body.errors).map(([k, v]: any) => `${k} : ${v[0]}`).join(" · ") : e.message); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      <div className="row">
        <input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} placeholder="adresse-de-la-page" aria-label="Adresse de la page" style={{ minWidth: 200 }} />
        <input value={f.placeLabel} onChange={(e) => setF({ ...f, placeLabel: e.target.value })} placeholder="Nom affiché (ex. Hôtel …)" aria-label="Nom affiché" style={{ minWidth: 220 }} />
      </div>
      <div className="row">
        <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Adresse complète" aria-label="Adresse" style={{ minWidth: 320 }} />
        <input value={f.gps} onChange={(e) => setF({ ...f, gps: e.target.value })} placeholder="48.8589, 2.3802" aria-label="Coordonnées GPS" style={{ minWidth: 180 }} />
      </div>
      <div className="row">
        <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value, removeCode: false })} placeholder={h.needsCode ? "Nouveau code d'accès (laisser vide pour garder)" : "Code d'accès (recommandé)"} aria-label="Code d'accès" style={{ minWidth: 280 }} />
        {h.needsCode && <label className="muted"><input type="checkbox" checked={f.removeCode} onChange={(e) => setF({ ...f, removeCode: e.target.checked, code: "" })} /> supprimer le code</label>}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => save(true)}>{h.enabled ? "Enregistrer" : "Activer la page"}</button>
        {h.enabled && <button className="btn" onClick={() => save(false)}>Désactiver</button>}
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  );
}

export function HostedPages() {
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<any[]>("/admin/partners").then((l) => { setList(l); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>Pages de réservation clé en main</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Pour un hôtel ou une agence sans développeur : une page à son nom pour réserver un transfert entre son adresse et un aéroport ou une gare. Les réservations sont créées et facturées à son compte, comme par l'API. Sans code d'accès, toute personne qui connaît l'adresse de la page peut réserver au compte du partenaire : un code est recommandé.
      </p>
      {err && <div className="err">{err}</div>}
      <table>
        <tbody>
          {list?.map((p) => (
            <tr key={p.id}>
              <td style={{ verticalAlign: "top" }}><b>{p.name}</b>{!p.active && <span className="chip bad"> inactif</span>}</td>
              <td>
                {p.hosted.enabled ? <><span className="chip ok">Active</span> <a href={p.hosted.url} target="_blank" rel="noreferrer">{p.hosted.url}</a>{p.hosted.needsCode ? " · avec code" : " · sans code"}</> : <span className="muted">Pas de page</span>}
                {open === p.id && <Editor p={p} onDone={load} />}
              </td>
              <td style={{ verticalAlign: "top" }}><button className="btn" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Fermer" : "Configurer"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
