"use client";
import { useCallback, useEffect, useState } from "react";
import { api, clearToken, dt, eur, getToken, setToken } from "../lib/api";

type Tab = "rides" | "alerts" | "drivers" | "partners";
const STATUS_TONE: Record<string, string> = {
  DISPATCHING: "warn", ASSIGNED: "ok", EN_ROUTE: "ok", ARRIVED: "ok", IN_PROGRESS: "ok", COMPLETED: "",
  CANCELLED_BY_PARTNER: "bad", CANCELLED_BY_CLIENT: "bad", NO_SHOW: "bad", DISPUTED: "bad",
};

function useLoad<T>(path: string, every = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setData(await api<T>(path)); setError(""); } catch (e: any) { setError(e.message); }
  }, [path]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, every);
    return () => clearInterval(t);
  }, [reload, every]);
  return { data, error, reload };
}

function Login({ onOk }: { onOk: () => void }) {
  const [t, setT] = useState("");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setToken(t);
    try { await api("/admin/alerts"); onOk(); } catch (e: any) { clearToken(); setErr(e.status === 401 ? "Token invalide" : e.message); }
  }
  return (
    <main style={{ maxWidth: 420, marginTop: 80 }}>
      <form className="card" onSubmit={submit}>
        <h2>Back-office</h2>
        <p className="muted">Saisissez le token administrateur.</p>
        <input type="password" value={t} onChange={(e) => setT(e.target.value)} placeholder="ADMIN_TOKEN" style={{ width: "100%" }} autoFocus />
        {err && <div className="err">{err}</div>}
        <p><button className="btn primary" disabled={!t}>Se connecter</button></p>
      </form>
    </main>
  );
}

function Rides() {
  const [status, setStatus] = useState("");
  const rides = useLoad<any[]>(`/admin/rides${status ? `?status=${status}` : ""}`);
  const drivers = useLoad<any[]>("/admin/drivers?status=ACTIVE", 15000);
  const alerts = useLoad<any[]>("/admin/alerts");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  async function assign(rideId: string) {
    try { await api(`/admin/rides/${rideId}/assign`, { driverId: pick[rideId] }); setErr(""); rides.reload(); alerts.reload(); }
    catch (e: any) { setErr(e.message); }
  }
  const list = rides.data ?? [];
  const count = (s: string) => list.filter((r) => r.status === s).length;
  return (
    <>
      <div className="kpis">
        <div className="card kpi"><span className="muted">À attribuer</span><b>{count("DISPATCHING")}</b></div>
        <div className={`card kpi ${alerts.data?.length ? "alert" : ""}`}><span className="muted">Alertes dispatch</span><b>{alerts.data?.length ?? 0}</b></div>
        <div className="card kpi"><span className="muted">En cours</span><b>{count("EN_ROUTE") + count("ARRIVED") + count("IN_PROGRESS")}</b></div>
        <div className="card kpi"><span className="muted">Terminées</span><b>{count("COMPLETED")}</b></div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {["DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED_BY_PARTNER", "NO_SHOW"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="muted">Actualisation automatique toutes les 5 s</span>
        </div>
        {(rides.error || err) && <div className="err">{rides.error || err}</div>}
        <div className="scroll">
          <table>
            <thead><tr><th>Prise en charge</th><th>Trajet</th><th>Partenaire</th><th>Prix / net</th><th>Statut</th><th>Chauffeur</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const alerted = alerts.data?.some((a) => a.rideId === r.id);
                const pending = r.offers.filter((o: any) => o.status === "PENDING").length;
                return (
                  <tr key={r.id}>
                    <td>{dt(r.pickupAt)}<br /><span className="muted">{r.category}</span></td>
                    <td>{r.pickupAddress}<br /><span className="muted">→ {r.dropoffAddress}</span></td>
                    <td>{r.booking.partner?.name ?? "—"}<br /><span className="muted">{r.booking.externalReference ?? ""}</span></td>
                    <td>{eur(r.priceCents)}<br /><span className="muted">net {eur(r.driverNetCents)}</span></td>
                    <td>
                      <span className={`badge ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>
                      {r.status === "DISPATCHING" && <div className="muted">{pending} offre(s) en attente</div>}
                      {alerted && <div className="err">⚠ Aucun chauffeur : à traiter</div>}
                    </td>
                    <td>
                      {r.driver ? `${r.driver.firstName} ${r.driver.lastName}` : r.status === "DISPATCHING" ? (
                        <div className="row">
                          <select value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                            <option value="">Attribuer à…</option>
                            {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
                          </select>
                          <button className="btn primary" disabled={!pick[r.id]} onClick={() => assign(r.id)}>OK</button>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={6} className="muted">Aucune course.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Drivers() {
  const drivers = useLoad<any[]>("/admin/drivers", 8000);
  const [msg, setMsg] = useState("");
  async function act(path: string, body: unknown = {}) {
    try { await api(path, body); setMsg(""); } catch (e: any) { setMsg(e.body?.missing ? `${e.message} : ${e.body.missing.join(", ")}` : e.message); }
    drivers.reload();
  }
  return (
    <div className="card">
      {(drivers.error || msg) && <div className="err">{drivers.error || msg}</div>}
      <div className="scroll">
        <table>
          <thead><tr><th>Chauffeur</th><th>Véhicule</th><th>Statut</th><th>Documents</th><th></th></tr></thead>
          <tbody>
            {drivers.data?.map((d) => (
              <tr key={d.id}>
                <td>{d.firstName} {d.lastName}<br /><span className="muted">{d.phone}</span></td>
                <td>{d.vehicles.map((v: any) => `${v.make} ${v.model} (${v.plate})`).join(", ") || "—"}</td>
                <td><span className={`badge ${d.status === "ACTIVE" ? "ok" : d.status === "SUSPENDED" ? "bad" : "warn"}`}>{d.status}</span></td>
                <td>
                  {d.documents.map((x: any) => (
                    <div key={x.id} className="row">
                      <span>{x.type}</span><span className={`badge ${x.status === "APPROVED" ? "ok" : x.status === "REJECTED" ? "bad" : "warn"}`}>{x.status}</span>
                      {x.status === "PENDING" && <>
                        <button className="btn" onClick={() => act(`/admin/documents/${x.id}/review`, { status: "APPROVED" })}>✓</button>
                        <button className="btn danger" onClick={() => act(`/admin/documents/${x.id}/review`, { status: "REJECTED" })}>✗</button>
                      </>}
                    </div>
                  )) || "—"}
                </td>
                <td>
                  {d.status !== "ACTIVE" && <button className="btn primary" onClick={() => act(`/admin/drivers/${d.id}/approve`)}>Valider</button>}{" "}
                  {d.status === "ACTIVE" && <button className="btn danger" onClick={() => act(`/admin/drivers/${d.id}/suspend`)}>Suspendre</button>}
                </td>
              </tr>
            ))}
            {!drivers.data?.length && <tr><td colSpan={5} className="muted">Aucun chauffeur.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Partners() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [created, setCreated] = useState<any>(null);
  const [err, setErr] = useState("");
  const hooks = useLoad<any[]>("/admin/webhooks", 8000);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { setCreated(await api("/admin/partners", { name, webhookUrl: url || undefined })); setErr(""); setName(""); setUrl(""); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <>
      <form className="card" onSubmit={create}>
        <h3>Nouveau partenaire</h3>
        <div className="row">
          <input placeholder="Nom (ex. Booking.com)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="URL webhook (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} style={{ minWidth: 280 }} />
          <button className="btn primary" disabled={!name}>Créer</button>
        </div>
        {err && <div className="err">{err}</div>}
        {created && (
          <div style={{ marginTop: 12 }}>
            <b>Copiez ces secrets maintenant : ils ne seront plus affichés.</b>
            <p>Clé API (sandbox) : <code>{created.apiKey}</code></p>
            {created.webhookSecret && <p>Secret webhook : <code>{created.webhookSecret}</code></p>}
          </div>
        )}
      </form>
      <div className="card">
        <h3>Derniers webhooks</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Événement</th><th>Statut</th><th>Tentatives</th><th>Erreur</th></tr></thead>
            <tbody>
              {hooks.data?.map((h) => (
                <tr key={h.id}>
                  <td>{dt(h.createdAt)}</td><td>{h.eventType}</td>
                  <td><span className={`badge ${h.status === "DELIVERED" ? "ok" : h.status === "FAILED" ? "bad" : "warn"}`}>{h.status}</span></td>
                  <td>{h.attempts}</td><td className="muted">{h.lastError ?? ""}</td>
                </tr>
              ))}
              {!hooks.data?.length && <tr><td colSpan={5} className="muted">Aucun webhook.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AlertsTab() {
  const alerts = useLoad<any[]>("/admin/alerts");
  return (
    <div className="card">
      <h3>Courses sans chauffeur après tous les tours de dispatch</h3>
      {alerts.error && <div className="err">{alerts.error}</div>}
      {alerts.data?.length ? (
        <table>
          <thead><tr><th>Prise en charge</th><th>Départ</th><th>Partenaire</th></tr></thead>
          <tbody>{alerts.data.map((a) => <tr key={a.rideId}><td>{dt(a.pickupAt)}</td><td>{a.pickup}</td><td>{a.partner}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">Aucune alerte. Attribuez manuellement depuis l'onglet Courses si besoin.</p>}
    </div>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("rides");
  useEffect(() => { setAuthed(Boolean(getToken())); setReady(true); }, []);
  if (!ready) return null;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  const tabs: [Tab, string][] = [["rides", "Courses"], ["alerts", "Alertes"], ["drivers", "Chauffeurs"], ["partners", "Partenaires"]];
  return (
    <>
      <header>
        <h1>VTC Back-office</h1>
        <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => { clearToken(); setAuthed(false); }}>Déconnexion</button>
      </header>
      <main>
        {tab === "rides" && <Rides />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "drivers" && <Drivers />}
        {tab === "partners" && <Partners />}
      </main>
    </>
  );
}
