"use client";
import { useCallback, useEffect, useState } from "react";
import { api, dt } from "../lib/api";

const STATUS: Record<string, string> = { SUBMITTED: "Reçue", IN_REVIEW: "En cours", ACCEPTED: "Acceptée", REJECTED: "Refusée", WITHDRAWN: "Retirée" };
const tone = (s: string) => (s === "ACCEPTED" ? "ok" : s === "REJECTED" || s === "WITHDRAWN" ? "bad" : "blue");
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const ACTION: Record<string, string> = {
  "application.submitted": "Candidature déposée", "application.checks": "Vérifications mises à jour", "application.tests": "Résultats des tests saisis",
  "application.interview": "Entretien enregistré", "application.accepted": "Acceptée", "application.rejected": "Refusée", "application.anonymized": "Données rendues anonymes",
};

function useLoad<T>(path: string, every = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => { try { setData(await api<T>(path)); setError(""); } catch (e: any) { setError(e.message); } }, [path]);
  useEffect(() => { reload(); const t = setInterval(reload, every); return () => clearInterval(t); }, [reload, every]);
  return { data, error, reload };
}

function Application({ id, onChanged }: { id: string; onChanged: () => void }) {
  const q = useLoad<any>(`/admin/applications/${id}`, 15000);
  const a = q.data;
  const [msg, setMsg] = useState("");
  const [card, setCard] = useState(""), [points, setPoints] = useState(""), [noSusp, setNoSusp] = useState(true), [honor, setHonor] = useState(false);
  const [fr, setFr] = useState(""), [en, setEn] = useState(""), [eth, setEth] = useState("");
  const [notes, setNotes] = useState(""), [reason, setReason] = useState("");
  if (!a) return <div className="muted">{q.error || "Chargement…"}</div>;
  const closed = ["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(a.status);

  async function act(path: string, body: unknown) {
    try { await api(path, body); setMsg(""); } catch (e: any) { setMsg(e.body?.missing ? `${e.message} : ${e.body.missing.join(" · ")}` : e.message); }
    q.reload(); onChanged();
  }
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const t = a.thresholds;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{a.firstName} {a.lastName} <span className="muted" style={{ fontSize: 13 }}>· réf. {a.ref}</span></b>
        <span className={`chip ${tone(a.status)}`}>{STATUS[a.status]}</span>
      </div>
      <div className="muted">{a.phone} · {a.email} · {a.yearsExperience} an(s) d'expérience · déposée le {dt(a.createdAt)}</div>
      <div className="chips">
        <span className={`chip ${a.sponsor?.founder ? "blue" : ""}`}>
          {a.sponsor?.founder ? `Cohorte fondatrice${a.sponsor.label ? ` : ${a.sponsor.label}` : ""}` : `Parrain : ${a.sponsor?.driver?.name ?? "?"}`} · {a.sponsor?.code}
        </span>
        {a.otherPlatforms?.map((p: any, i: number) => <span className="chip" key={i} title="Déclaratif, non vérifié">{p.name}{p.rating ? ` · ${p.rating}/5` : ""}</span>)}
      </div>
      {a.otherPlatforms?.length > 0 && <div className="muted" style={{ fontSize: 12 }}>Notes déclarées, non vérifiables : à discuter en entretien, jamais éliminatoires seules.</div>}

      {(msg || q.error) && <div className="card redbg" style={{ marginTop: 10 }}>{msg || q.error}</div>}

      {!closed && a.missing.length > 0 && (
        <div className="card yel" style={{ marginTop: 12 }}>
          <div className="cond">Reste à faire avant décision</div>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{a.missing.map((m: string) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {!closed && a.ready && <div className="card" style={{ marginTop: 12 }}><b>Tous les critères sont remplis : prête pour décision.</b></div>}

      {!closed && (
        <div className="grid" style={{ marginTop: 12 }}>
          <div>
            <div className="cond">1 · Documents et permis</div>
            <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
              Consultez la carte pro et le relevé d'information intégral (RII) du candidat, puis saisissez seulement le résultat. Le RII n'est pas conservé et le nombre de points n'est pas enregistré (seuil : {t.minPoints}).
            </div>
            <label className="muted">Carte pro valable jusqu'au</label>
            <input type="date" value={card} onChange={(e) => setCard(e.target.value)} />
            <div className="row" style={{ marginTop: 6 }}>
              <input type="number" min={0} max={12} placeholder="Points restants" value={points} onChange={(e) => setPoints(e.target.value)} style={{ width: 150 }} />
              <label><input type="checkbox" checked={noSusp} onChange={(e) => setNoSusp(e.target.checked)} /> Aucune suspension en cours</label>
            </div>
            <label style={{ display: "block", marginTop: 6 }}><input type="checkbox" checked={honor} onChange={(e) => setHonor(e.target.checked)} /> Déclaration sur l'honneur reçue</label>
            <button className="btn" style={{ marginTop: 8 }} onClick={() => act(`/admin/applications/${id}/checks`, {
              ...(card ? { cardProValidUntil: card } : {}), ...(points !== "" ? { licencePoints: Number(points), licenceNoSuspension: noSusp } : {}), ...(honor ? { honorStatement: true } : {}),
            })}>Enregistrer</button>
            <div className="chips">
              <span className={`chip ${a.checks.cardProValidUntil ? "ok" : ""}`}>Carte pro {a.checks.cardProValidUntil ? `jusqu'au ${new Date(a.checks.cardProValidUntil).toLocaleDateString("fr-FR")}` : "à vérifier"}</span>
              <span className={`chip ${a.checks.licenceCheckedAt ? (a.checks.licencePointsOk && a.checks.licenceNoSuspension ? "ok" : "bad") : ""}`}>Permis {a.checks.licenceCheckedAt ? (a.checks.licencePointsOk && a.checks.licenceNoSuspension ? "conforme" : "non conforme") : "à vérifier"}</span>
              <span className={`chip ${a.checks.honorStatementAt ? "ok" : ""}`}>Honneur {a.checks.honorStatementAt ? "reçue" : "attendue"}</span>
            </div>
          </div>
          <div>
            <div className="cond">2 · Tests (mises en situation)</div>
            <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>Minimums : français {t.minFrench}/100 · anglais {t.minEnglish} · éthique {t.minEthics}/100.</div>
            <div className="row">
              <input type="number" min={0} max={100} placeholder="Français /100" value={fr} onChange={(e) => setFr(e.target.value)} style={{ width: 130 }} />
              <select value={en} onChange={(e) => setEn(e.target.value)}><option value="">Anglais…</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
              <input type="number" min={0} max={100} placeholder="Éthique /100" value={eth} onChange={(e) => setEth(e.target.value)} style={{ width: 130 }} />
            </div>
            <button className="btn" style={{ marginTop: 8 }} onClick={() => act(`/admin/applications/${id}/tests`, { ...(num(fr) !== undefined ? { frenchScore: num(fr) } : {}), ...(en ? { englishLevel: en } : {}), ...(num(eth) !== undefined ? { ethicsScore: num(eth) } : {}) })}>Enregistrer</button>
            <div className="chips">
              <span className="chip">Français {a.tests.frenchScore ?? "—"}</span><span className="chip">Anglais {a.tests.englishLevel ?? "—"}</span><span className="chip">Éthique {a.tests.ethicsScore ?? "—"}</span>
            </div>
          </div>
          <div>
            <div className="cond">3 · Entretien</div>
            <textarea rows={4} style={{ width: "100%" }} placeholder="Compte rendu d'entretien : motivations, mises en situation, points d'attention…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button className="btn" style={{ marginTop: 8 }} disabled={notes.trim().length < 3} onClick={() => act(`/admin/applications/${id}/interview`, { notes })}>Enregistrer l'entretien</button>
            {a.interview.at && <div className="muted" style={{ fontSize: 12 }}>Entretien enregistré le {dt(a.interview.at)} par {a.interview.by}.</div>}
          </div>
        </div>
      )}

      {!closed && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!a.ready} title={a.ready ? "" : "Critères manquants : aucune dérogation"} onClick={() => confirm("Accepter cette candidature et créer le compte chauffeur ?") && act(`/admin/applications/${id}/accept`, {})}>Accepter</button>
          <input placeholder="Motif du refus (communiqué au candidat)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn danger" disabled={reason.trim().length < 5} onClick={() => act(`/admin/applications/${id}/reject`, { reason })}>Refuser</button>
        </div>
      )}
      {a.status === "REJECTED" && <div className="muted" style={{ marginTop: 10 }}>Motif : {a.decision.reason}</div>}
      {a.status === "ACCEPTED" && <div className="muted" style={{ marginTop: 10 }}>Compte chauffeur créé : il lui reste ses documents et son véhicule, à valider dans l'onglet Chauffeurs.</div>}

      <details style={{ marginTop: 12 }}>
        <summary className="cond">Historique des décisions ({a.history.length})</summary>
        {a.history.map((h: any, i: number) => <div key={i} className="muted" style={{ fontSize: 13 }}>{dt(h.at)} · {h.actor} · {ACTION[h.action] ?? h.action}{h.data?.reason ? ` : ${h.data.reason}` : ""}</div>)}
      </details>
      {closed && a.status !== "ACCEPTED" && <button className="btn" style={{ marginTop: 10 }} onClick={() => confirm("Rendre cette candidature anonyme (irréversible) ?") && act(`/admin/applications/${id}/anonymize`, {})}>Effacer les données du candidat</button>}
    </div>
  );
}

function Applications() {
  const [status, setStatus] = useState("");
  const list = useLoad<any[]>(`/admin/applications${status ? `?status=${status}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="card filters">
        <span className="cond muted">Statut</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Toutes</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {list.error && <div className="card redbg">{list.error}</div>}
      {list.data?.map((a) => (
        <div key={a.id}>
          <div className="card" onClick={() => setOpen(open === a.id ? null : a.id)} style={{ cursor: "pointer", marginBottom: open === a.id ? 8 : 20 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{a.firstName} {a.lastName}</b>
              <span className="chips" style={{ margin: 0 }}>
                {a.status !== "ACCEPTED" && a.status !== "REJECTED" && a.status !== "WITHDRAWN" && <span className={`chip ${a.ready ? "ok" : ""}`}>{a.ready ? "Prête" : `${a.missing.length} à faire`}</span>}
                <span className={`chip ${tone(a.status)}`}>{STATUS[a.status]}</span>
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{a.sponsor?.founder ? "Fondateur" : `Parrain : ${a.sponsor?.driver?.name ?? "?"}`} · {a.yearsExperience} an(s) · {dt(a.createdAt)}</div>
          </div>
          {open === a.id && <Application id={a.id} onChanged={list.reload} />}
        </div>
      ))}
      {list.data && !list.data.length && <div className="card">Aucune candidature.</div>}
    </>
  );
}

function Codes() {
  const codes = useLoad<any[]>("/admin/applications/codes");
  const [label, setLabel] = useState(""), [count, setCount] = useState("1"), [max, setMax] = useState("1"), [msg, setMsg] = useState("");
  async function act(path: string, body: unknown) { try { await api(path, body); setMsg(""); } catch (e: any) { setMsg(e.message); } codes.reload(); }
  return (
    <>
      <div className="card">
        <h3>Créer des codes fondateurs</h3>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Pour la première cohorte de chauffeurs. Ils passent la même vérification que les autres : le parrainage ne dispense de rien.</div>
        <div className="row">
          <input placeholder="Destinataire ou lot (ex. Thomas)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 80 }} title="Nombre de codes" />
          <input type="number" min={1} max={20} value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 80 }} title="Utilisations par code" />
          <button className="btn primary" disabled={label.trim().length < 2} onClick={() => act("/admin/applications/codes", { label, count: Number(count), maxUses: Number(max) })}>Créer</button>
        </div>
        {msg && <div className="err">{msg}</div>}
      </div>
      <table>
        <thead><tr><th>Code</th><th>Origine</th><th>Utilisation</th><th>État</th><th /></tr></thead>
        <tbody>
          {codes.data?.map((c) => (
            <tr key={c.id}>
              <td><code>{c.code}</code></td>
              <td>{c.founder ? `Fondateur${c.label ? ` : ${c.label}` : ""}` : `Chauffeur : ${c.owner}`}</td>
              <td>{c.uses} / {c.maxUses}</td>
              <td><span className={`chip ${c.revoked ? "bad" : c.uses >= c.maxUses ? "" : "ok"}`}>{c.revoked ? "Révoqué" : c.uses >= c.maxUses ? "Utilisé" : "Disponible"}</span></td>
              <td>{!c.revoked && <button className="btn danger" onClick={() => confirm("Révoquer ce code ?") && act(`/admin/applications/codes/${c.id}/revoke`, {})}>Révoquer</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {codes.data && !codes.data.length && <div className="card">Aucun code.</div>}
    </>
  );
}

function Tree() {
  const t = useLoad<any[]>("/admin/applications/tree", 30000);
  const byParent = new Map<string | null, any[]>();
  for (const d of t.data ?? []) byParent.set(d.sponsorId, [...(byParent.get(d.sponsorId) ?? []), d]);
  const render = (parent: string | null, depth: number): any =>
    (byParent.get(parent) ?? []).map((d) => (
      <div key={d.id}>
        <div style={{ marginLeft: depth * 24, padding: "4px 0" }}>
          {depth > 0 ? "↳ " : ""}<b>{d.name}</b> <span className={`chip ${d.status === "ACTIVE" ? "ok" : d.status === "SUSPENDED" ? "bad" : ""}`}>{d.status}</span>
          {d.founder && <span className="chip blue" style={{ marginLeft: 6 }}>Fondateur{d.founderLabel ? ` : ${d.founderLabel}` : ""}</span>}
        </div>
        {render(d.id, depth + 1)}
      </div>
    ));
  return (
    <div className="card">
      <h3>Qui a fait entrer qui</h3>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Chaîne de parrainage de tous les chauffeurs issus d'une candidature : la preuve à montrer à un partenaire qui audite votre méthode.</div>
      {render(null, 0)}
      {t.data && !t.data.length && <div className="muted">Aucun chauffeur pour l'instant.</div>}
    </div>
  );
}

export function Recruitment() {
  const [sub, setSub] = useState<"apps" | "codes" | "tree">("apps");
  return (
    <>
      <h1 className="title">Recrutement</h1>
      <div className="tabs2">
        {([["apps", "Candidatures"], ["codes", "Codes de parrainage"], ["tree", "Arbre de parrainage"]] as const).map(([k, l]) => (
          <button key={k} className={`btn ${sub === k ? "primary" : ""}`} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {sub === "apps" && <Applications />}
      {sub === "codes" && <Codes />}
      {sub === "tree" && <Tree />}
    </>
  );
}
