"use client";
import { useCallback, useEffect, useState } from "react";
import { api, dt, eur } from "../lib/api";

type Row = { line?: number; id?: string; partner?: string; reference: string | null; pickupAt: string | null; pickup: string; dropoff: string; passenger: string; flightNumber: string | null; passengers: number; priceCents: number | null; category: string; errors: string[]; already?: string | null };
type Preview = { headers: string[]; mapping: Record<string, number>; fields: { field: string; label: string }[]; rows: Row[] };

/** Lit le fichier en UTF-8, ou en Windows-1252 si Excel l'a enregistré ainsi (accents illisibles sinon). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

/**
 * Import de courses envoyées en CSV par un donneur d'ordre. Les courses restent en attente, hors Radar ;
 * le dispatcheur les met au Radar une par une quand il le décide.
 */
export function RideImports() {
  const [partners, setPartners] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const loadPending = useCallback(async () => {
    try { setPending(await api<Row[]>("/admin/imports/rides")); } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => {
    api<any[]>("/admin/partners").then((l) => setPartners(l.filter((p) => p.active))).catch((e) => setMsg(e.message));
    loadPending();
  }, [loadPending]);

  async function runPreview(map?: Record<string, number>) {
    if (!partnerId || !file) return;
    setBusy("preview"); setMsg("");
    try {
      const p = await api<Preview>("/admin/imports/preview", { partnerId, csv: file.text, ...(map ? { mapping: map } : {}) });
      setPreview(p); setMapping(p.mapping);
    } catch (e: any) { setMsg(e.message); setPreview(null); } finally { setBusy(""); }
  }
  useEffect(() => { if (partnerId && file) runPreview(); }, [partnerId, file]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeField(field: string, value: string) {
    const next = { ...mapping };
    if (value === "") delete next[field]; else next[field] = Number(value);
    setMapping(next); runPreview(next);
  }

  async function doImport() {
    if (!partnerId || !file) return;
    setBusy("import"); setMsg("");
    try {
      const r = await api<{ created: number; updated: number; skipped: number }>("/admin/imports", { partnerId, fileName: file.name, csv: file.text, mapping });
      setMsg(`Import terminé : ${r.created} nouvelle(s), ${r.updated} mise(s) à jour, ${r.skipped} déjà au Radar (ignorée(s)).`);
      setFile(null); setPreview(null); loadPending();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  }

  async function act(id: string, action: "publish" | "discard") {
    if (action === "discard" && !confirm("Écarter cette course ? Les données du voyageur seront effacées.")) return;
    setBusy(id); setMsg("");
    try {
      const r = await api<any>(`/admin/imports/rides/${id}/${action}`, {});
      setMsg(action === "publish" ? `Course ${r.reference} mise au Radar.` : "Course écartée.");
      loadPending();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  }

  const okRows = preview?.rows.filter((r) => !r.errors.length && r.already !== "PUBLISHED").length ?? 0;
  return (
    <>
      <h1 className="title">Import de courses</h1>
      <div className="card">
        <h3>1. Déposer un fichier CSV</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label>Donneur d'ordre{" "}
            <select aria-label="Donneur d'ordre" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Choisir…</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <input aria-label="Fichier CSV" type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            if (f.size > 850_000) { setMsg("Fichier trop gros (850 Ko au plus) : découpez-le."); return; }
            setFile({ name: f.name, text: await readText(f) });
          }} />
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Les courses importées restent <b>en attente, hors Radar</b>. Vous les mettez au Radar une par une, quand vous le décidez. Les lignes déjà importées (même référence) sont mises à jour, jamais dupliquées.</p>
      </div>

      {preview && (
        <div className="card">
          <h3>2. Vérifier les colonnes</h3>
          <p className="muted">CliCab a reconnu les colonnes ci-dessous. Corrigez si besoin : le choix est mémorisé pour ce donneur d'ordre.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {preview.fields.map((f) => (
              <label key={f.field} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="cond muted">{f.label}</span>
                <select aria-label={f.label} value={mapping[f.field] ?? ""} onChange={(e) => changeField(f.field, e.target.value)}>
                  <option value="">— absent du fichier —</option>
                  {preview.headers.map((h, i) => <option key={i} value={i}>{h || `Colonne ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <h3 style={{ marginTop: 16 }}>3. Aperçu ({preview.rows.length} ligne(s))</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Ligne</th><th>Réf.</th><th>Prise en charge</th><th>Trajet</th><th>Voyageur</th><th>Vol</th><th>Pax</th><th>Prix</th><th>État</th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td><td>{r.reference ?? "—"}</td><td>{r.pickupAt ? dt(r.pickupAt) : "—"}</td>
                  <td>{r.pickup || "?"} → {r.dropoff || "?"}</td><td>{r.passenger}</td><td>{r.flightNumber ?? ""}</td><td>{r.passengers}</td>
                  <td>{r.priceCents ? eur(r.priceCents) : "grille CliCab"}</td>
                  <td>{r.already === "PUBLISHED" ? <span className="chip">déjà au Radar</span> : r.errors.length ? <span className="chip bad">{r.errors.join(" · ")}</span> : <span className="chip ok">prête</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <button className="btn primary" style={{ marginTop: 12 }} disabled={!!busy || !preview.rows.length} onClick={doImport}>
            {busy === "import" ? "Import…" : `Importer en attente (${okRows} prête(s), lignes en erreur gardées pour correction)`}
          </button>
        </div>
      )}

      {msg && <div className="card">{msg}</div>}

      <div className="card">
        <h3>Courses en attente ({pending?.length ?? "…"})</h3>
        <p className="muted">Prix : celui du fichier s'il y en a un, sinon la grille CliCab (à confirmer). Les aéroports et gares parisiens sont reconnus directement ; les autres adresses sont localisées par la Base Adresse Nationale.</p>
        {pending && !pending.length && <p className="muted">Aucune course en attente.</p>}
        {!!pending?.length && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Prise en charge</th><th>Donneur d'ordre</th><th>Réf.</th><th>Trajet</th><th>Voyageur</th><th>Prix</th><th></th></tr></thead>
              <tbody>{pending.map((r) => (
                <tr key={r.id}>
                  <td>{r.pickupAt ? dt(r.pickupAt) : "—"}</td><td>{r.partner}</td><td>{r.reference ?? "—"}</td>
                  <td>{r.pickup} → {r.dropoff}{r.flightNumber ? ` · ✈ ${r.flightNumber}` : ""}</td><td>{r.passenger} · {r.passengers} pax</td>
                  <td>{r.priceCents ? eur(r.priceCents) : "grille"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.errors.length ? <span className="chip bad" title={r.errors.join(" · ")}>à corriger</span>
                      : <button className="btn primary" disabled={!!busy} onClick={() => act(r.id!, "publish")}>{busy === r.id ? "…" : "Mettre au Radar"}</button>}{" "}
                    <button className="btn" disabled={!!busy} onClick={() => act(r.id!, "discard")}>Écarter</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
