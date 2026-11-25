"use client";
import { useEffect, useState } from "react";
import { api, dt } from "../lib/api";

const stages = { PROSPECT: "Prospection", CONTACTED: "Contact établi", OFFER: "Offre envoyée", NEGOTIATION: "Négociation", WON: "Contrat signé", LOST: "Perdu" } as const;
const kinds = { HOTEL: "Hôtel", COMPANY: "Entreprise", AGENCY: "Agence de voyages", CONCIERGE: "Conciergerie", OTHER: "Autre" } as const;
const channels = { CALL: "Appel", EMAIL: "E-mail", MEETING: "Rendez-vous", NOTE: "Note" } as const;
type Stage = keyof typeof stages;
type Kind = keyof typeof kinds;
type Channel = keyof typeof channels;
type Partner = { id: string; name: string; active: boolean; _count?: { bookings: number } };
type Interaction = { id: string; kind: Channel; note: string; actor: string; createdAt: string };
type Account = { id: string; name: string; stage: Stage; kind: Kind; contactName: string | null; email: string | null; phone: string | null; nextAction: string | null; nextActionAt: string | null; partnerId: string | null; partner?: Partner | null; interactions?: Interaction[] };
type Listing = { items: Account[]; total: number; pipeline: { stage: Stage; count: number }[]; overdue: number };
const empty = () => ({ name: "", kind: "OTHER" as Kind, stage: "PROSPECT" as Stage, contactName: "", email: "", phone: "", nextAction: "", nextActionAt: "", partnerId: "" });
function localDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function Crm() {
  const [list, setList] = useState<Listing | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [due, setDue] = useState(false);
  const [page, setPage] = useState(1);
  const [rev, setRev] = useState(0);
  const [selected, setSelected] = useState<Account | null>(null);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [channel, setChannel] = useState<Channel>("CALL");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api<Partner[]>("/admin/crm/partners").then(p => { if (alive) setPartners(p); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ q, page: String(page), ...(stage ? { stage } : {}), ...(due ? { overdue: "1" } : {}) });
    const timer = setTimeout(() => {
      api<Listing>("/admin/crm?" + params).then(r => { if (alive) setList(r); }).catch(e => { if (alive) setError(e.message); });
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, stage, due, page, rev]);
  const refresh = () => setRev(r => r + 1);
  const newAccount = () => { setSelected(null); setForm(empty()); setNote(""); setEditing(true); setError(""); };
  async function open(id: string) {
    setBusy(true); setError("");
    try {
      const a = await api<Account>("/admin/crm/" + id);
      setSelected(a); setForm({ name: a.name, kind: a.kind, stage: a.stage, contactName: a.contactName ?? "", email: a.email ?? "", phone: a.phone ?? "", nextAction: a.nextAction ?? "", nextActionAt: localDate(a.nextActionAt), partnerId: a.partnerId ?? "" }); setEditing(true); setNote("");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const payload = { ...form, contactName: form.contactName.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, nextAction: form.nextAction.trim() || null, nextActionAt: form.nextActionAt ? new Date(form.nextActionAt).toISOString() : null, partnerId: form.partnerId || null };
      const a = await api<Account>(selected ? "/admin/crm/" + selected.id : "/admin/crm", payload);
      refresh(); await open(a.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function addNote(e: React.FormEvent) {
    e.preventDefault(); if (!selected) return;
    setBusy(true); setError("");
    try {
      const id = selected.id;
      const n = await api<Interaction>("/admin/crm/" + id + "/interactions", { kind: channel, note });
      setSelected(a => a?.id === id ? { ...a, interactions: [n, ...(a.interactions ?? [])].slice(0, 100) } : a);
      setNote("");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm("Supprimer définitivement cette fiche et ses notes ? Le partenaire et ses réservations seront conservés.")) return;
    setBusy(true); setError("");
    try { await api("/admin/crm/" + selected.id + "/delete", {}); setSelected(null); setEditing(false); setPage(1); refresh(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return <>
    <h1 className="title">CRM · Gestion commerciale</h1>
    <div className="card">
      <div className="row" style={{ flexWrap: "wrap" }}>
        {Object.entries(stages).map(([key, label]) => <button key={key} className={"btn " + (stage === key ? "primary" : "")} onClick={() => { setStage(stage === key ? "" : key); setPage(1); }}>{label} · {list?.pipeline.find(p => p.stage === key)?.count ?? "—"}</button>)}
        <button className={"btn " + (due ? "primary" : "")} onClick={() => { setDue(!due); setPage(1); }}>Relances échues · {list?.overdue ?? "—"}</button>
      </div>
    </div>
    {error && <div className="err" role="alert">{error}</div>}
    <div className="card">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input aria-label="Rechercher une fiche" placeholder="Nom, contact, e-mail, téléphone" value={q} maxLength={160} onChange={e => { setQ(e.target.value); setPage(1); }} />
        <button className="btn" onClick={() => { setQ(""); setStage(""); setDue(false); setPage(1); refresh(); }}>Réinitialiser</button>
        <button className="btn primary" disabled={busy} onClick={newAccount}>Nouveau prospect</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table><thead><tr><th>Compte</th><th>Catégorie</th><th>Étape</th><th>Contact</th><th>Relance</th><th>Réservations</th><th></th></tr></thead>
        <tbody>{list?.items.map(a => <tr key={a.id}>
          <td><b>{a.name}</b></td><td>{kinds[a.kind]}</td><td>{stages[a.stage]}</td>
          <td>{a.contactName || "—"}</td>
          <td>{a.nextActionAt ? <span className={"chip " + (a.stage !== "LOST" && Date.parse(a.nextActionAt) <= Date.now() ? "bad" : "")}>{dt(a.nextActionAt)} · {a.nextAction}</span> : "—"}</td>
          <td>{a.partner?._count?.bookings ?? "—"}</td>
          <td><button className="btn" disabled={busy} onClick={() => open(a.id)}>Ouvrir</button></td>
        </tr>)}</tbody></table>
      </div>
      {list && !list.items.length && <p className="muted">Aucune fiche correspondante.</p>}
      <div className="row"><button className="btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button><span>Page {page} · {list?.total ?? "—"} fiches</span><button className="btn" disabled={!list || page * 50 >= list.total} onClick={() => setPage(p => p + 1)}>Suivant</button></div>
    </div>
    {editing && <div className="card">
      <h3>{selected ? selected.name : "Nouveau prospect"}</h3>
      <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <fieldset disabled={busy} style={{ display: "grid", gap: 10, border: 0, padding: 0, margin: 0 }}>
          <label>Organisation <input required minLength={2} maxLength={160} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></label>
          <label>Catégorie <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as Kind }))}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Étape <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value as Stage }))}>{Object.entries(stages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Nom du contact <input maxLength={120} value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}/></label>
          <label>E-mail <input type="email" maxLength={200} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/></label>
          <label>Téléphone <input type="tel" maxLength={40} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}/></label>
          <label>Action à effectuer <input maxLength={500} value={form.nextAction} onChange={e => setForm(f => ({ ...f, nextAction: e.target.value }))}/></label>
          <label>Échéance <input type="datetime-local" required={!!form.nextAction} value={form.nextActionAt} onChange={e => setForm(f => ({ ...f, nextActionAt: e.target.value }))}/></label>
          <label>Partenaire CliCab existant <select value={form.partnerId} onChange={e => setForm(f => ({ ...f, partnerId: e.target.value }))}><option value="">Non associé</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactif)"}</option>)}</select></label>
          <div className="row"><button className="btn primary" type="submit">Enregistrer</button><button className="btn" type="button" onClick={() => setEditing(false)}>Fermer</button>{selected && <button className="btn danger" type="button" onClick={remove}>Supprimer</button>}</div>
        </fieldset>
      </form>
      {selected && <>
        <h3>Historique des échanges</h3>
        <form onSubmit={addNote} className="row" style={{ flexWrap: "wrap" }}>
          <select aria-label="Type d'échange" value={channel} onChange={e => setChannel(e.target.value as Channel)}>{Object.entries(channels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <textarea aria-label="Compte rendu" required maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="Compte rendu professionnel, sans données sensibles" />
          <button className="btn" disabled={busy || !note.trim()}>Ajouter</button>
        </form>
        {selected.interactions?.map(n => <div key={n.id} style={{ borderTop: "1px solid #aaa", padding: "10px 0" }}><b>{channels[n.kind]}</b> · {dt(n.createdAt)} · {n.actor}<p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.note}</p></div>)}
        {!selected.interactions?.length && <p className="muted">Aucun échange enregistré.</p>}
      </>}
    </div>}
  </>;
}
