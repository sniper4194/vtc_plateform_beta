"use client";
import { useCallback, useEffect, useState } from "react";
import { api, AdminSession, clearToken, dt, eur, getToken, getUser, login, setToken, setUser } from "../lib/api";
import { PerformanceView } from "./perf";

type Tab = "rides" | "alerts" | "perf" | "drivers" | "companies" | "partners" | "team" | "account";
const OPEN_FLIGHT = ["DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED"];
const COLUMNS: { title: string; statuses: string[]; tone: string }[] = [
  { title: "À attribuer", statuses: ["DISPATCHING"], tone: "yel" },
  { title: "Attribuées", statuses: ["ASSIGNED"], tone: "" },
  { title: "En mouvement", statuses: ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"], tone: "" },
  { title: "Bouclées", statuses: ["COMPLETED", "NO_SHOW", "CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT", "DISPUTED", "REFUNDED"], tone: "" },
];
const STATUS_LABEL: Record<string, string> = {
  DISPATCHING: "En recherche", ASSIGNED: "Attribuée", EN_ROUTE: "En route", ARRIVED: "Sur place", IN_PROGRESS: "À bord",
  COMPLETED: "Terminée", NO_SHOW: "Client absent", CANCELLED_BY_PARTNER: "Annulée", CANCELLED_BY_CLIENT: "Annulée", DISPUTED: "Litige", REFUNDED: "Remboursée",
};
const chipTone = (s: string) => (["COMPLETED", "ASSIGNED"].includes(s) ? "ok" : ["NO_SHOW", "CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT", "DISPUTED"].includes(s) ? "bad" : "blue");

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { const r = await login(email, password); setToken(r.token); setUser(r.user); onOk(); }
    catch (e: any) { setErr(e.status === 429 ? e.message : e.status === 401 ? "E-mail ou mot de passe incorrect" : e.message); }
    finally { setBusy(false); }
  }
  return (
    <main style={{ maxWidth: 460, marginTop: 70 }}>
      <div className="brand" style={{ fontSize: 64, marginBottom: 24 }}>ÉTOILE<small>tour de contrôle</small></div>
      <form className="card" onSubmit={submit}>
        <div className="cond muted">E-mail</div>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", margin: "6px 0 12px" }} autoFocus />
        <div className="cond muted">Mot de passe</div>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", margin: "6px 0" }} />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={!email || !password || busy}>{busy ? "Connexion…" : "Entrer"}</button>
      </form>
    </main>
  );
}

function Route({ from, to }: { from: string; to: string }) {
  return (
    <div className="route">
      <div className="rail"><i /><u /><em /></div>
      <div><span>{from}</span><span>{to}</span></div>
    </div>
  );
}

function FlightControl({ ride, onDone, onError }: { ride: any; onDone: () => void; onError: (m: string) => void }) {
  const [min, setMin] = useState("");
  async function apply() {
    const m = Number(min);
    if (!Number.isFinite(m) || m < 0) return onError("Retard invalide");
    try {
      await api(`/admin/rides/${ride.id}/flight`, { estimatedArrivalAt: m > 0 ? new Date(new Date(ride.pickupAt).getTime() + m * 60_000).toISOString() : null });
      onError(""); setMin(""); onDone();
    } catch (e: any) { onError(e.message); }
  }
  return (
    <>
      <input type="number" min={0} placeholder="Retard (min)" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Retard du vol en minutes" />
      <button className="btn" disabled={min === ""} onClick={apply}>Vol</button>
    </>
  );
}

function Board() {
  const rides = useLoad<any[]>("/admin/rides");
  const drivers = useLoad<any[]>("/admin/drivers?status=ACTIVE", 15000);
  const alerts = useLoad<any[]>("/admin/alerts");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  async function assign(rideId: string) {
    try { await api(`/admin/rides/${rideId}/assign`, { driverId: pick[rideId] }); setErr(""); rides.reload(); alerts.reload(); }
    catch (e: any) { setErr(e.message); }
  }
  const list = rides.data ?? [];
  const n = (...s: string[]) => list.filter((r) => s.includes(r.status)).length;
  const alerted = new Set((alerts.data ?? []).map((a) => a.rideId));
  return (
    <>
      <div className="kpis">
        <div className="sticker s1"><span className="cond">À attribuer</span><b>{n("DISPATCHING")}</b></div>
        <div className={`sticker s2 ${alerts.data?.length ? "alert" : ""}`}><span className="cond">Alertes</span><b>{alerts.data?.length ?? 0}</b></div>
        <div className="sticker s3"><span className="cond">En mouvement</span><b>{n("EN_ROUTE", "ARRIVED", "IN_PROGRESS")}</b></div>
        <div className="sticker s4"><span className="cond">Terminées</span><b>{n("COMPLETED")}</b></div>
      </div>
      {(rides.error || err) && <div className="card redbg">{rides.error || err}</div>}
      <div className="board">
        {COLUMNS.map((col) => {
          const items = list.filter((r) => col.statuses.includes(r.status));
          return (
            <section className="col" key={col.title}>
              <h2>{col.title}<span className="n">{items.length}</span></h2>
              {items.map((r) => {
                const pending = r.offers.filter((o: any) => o.status === "PENDING").length;
                return (
                  <article className="card ride" key={r.id}>
                    <div className="price"><div><b style={{ fontSize: eur(r.driverNetCents).replace(",00", "").length > 6 ? 15 : 20 }}>{eur(r.driverNetCents).replace(",00", "")}</b><br /><span>net</span></div></div>
                    <div className="when">{dt(r.pickupAt)}</div>
                    <Route from={r.pickupAddress} to={r.dropoffAddress} />
                    <div className="chips">
                      <span className={`chip ${chipTone(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      <span className="chip">{r.category}</span>
                      <span className="chip">{r.booking.partner?.name ?? "—"}</span>
                      <span className="chip">Client {eur(r.priceCents).replace(",00", "")}</span>
                    </div>
                    {r.booking.flightNumber && (
                      <div className="flightrow">
                        <span className={`chip ${r.flightDelayMin > 0 ? "ok" : ""}`}>✈ {r.booking.flightNumber}{r.flightDelayMin > 0 ? ` +${r.flightDelayMin} min` : ""}</span>
                        {OPEN_FLIGHT.includes(r.status) && <FlightControl ride={r} onDone={rides.reload} onError={setErr} />}
                      </div>
                    )}
                    {r.driver && <p style={{ margin: "10px 0 0" }}><span className="cond muted">Chauffeur</span><br /><b style={{ fontFamily: "var(--slab)", fontWeight: 400 }}>{r.driver.firstName} {r.driver.lastName}</b></p>}
                    {r.status === "DISPATCHING" && (
                      <>
                        <p className="muted" style={{ margin: "10px 0 6px" }}>{pending} offre(s) en circulation</p>
                        {alerted.has(r.id) && <div className="alertbar">⚠ Personne n'a pris la mission : à vous de jouer</div>}
                        <div className="row" style={{ marginTop: 10 }}>
                          <select value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                            <option value="">Attribuer à…</option>
                            {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
                          </select>
                          <button className="btn primary" disabled={!pick[r.id]} onClick={() => assign(r.id)}>OK</button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
              {!items.length && <div className="card muted" style={{ boxShadow: "none", borderStyle: "dashed", background: "transparent", color: "var(--cream)" }}>Rien ici.</div>}
            </section>
          );
        })}
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
    <>
      <h1 className="title">Chauffeurs</h1>
      {(drivers.error || msg) && <div className="card redbg">{drivers.error || msg}</div>}
      <div className="grid">
        {drivers.data?.map((d) => (
          <div className="card" key={d.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{d.firstName} {d.lastName}</b>
              <span className={`chip ${d.status === "ACTIVE" ? "ok" : d.status === "SUSPENDED" ? "bad" : ""}`}>{d.status}</span>
            </div>
            <div className="muted">{d.phone}</div>
            <div className="chips">{d.vehicles.map((v: any) => <span className="chip blue" key={v.id}>{v.make} {v.model} · {v.plate}</span>)}</div>
            <div style={{ margin: "12px 0" }}>
              {d.documents.map((x: any) => (
                <div className="doc" key={x.id}>
                  <span className="cond">{x.type}</span>
                  <span className={`chip ${x.status === "APPROVED" ? "ok" : x.status === "REJECTED" ? "bad" : ""}`}>{x.status}</span>
                  {x.status === "PENDING" && <>
                    <button className="btn" onClick={() => act(`/admin/documents/${x.id}/review`, { status: "APPROVED" })}>✓</button>
                    <button className="btn danger" onClick={() => act(`/admin/documents/${x.id}/review`, { status: "REJECTED" })}>✗</button>
                  </>}
                </div>
              ))}
              {!d.documents.length && <span className="muted">Aucun document</span>}
            </div>
            {d.status !== "ACTIVE" && <button className="btn primary" onClick={() => act(`/admin/drivers/${d.id}/approve`)}>Valider le chauffeur</button>}
            {d.status === "ACTIVE" && <button className="btn danger" onClick={() => act(`/admin/drivers/${d.id}/suspend`)}>Suspendre</button>}
          </div>
        ))}
      </div>
      {!drivers.data?.length && <div className="card">Aucun chauffeur.</div>}
    </>
  );
}

function AdminPerformance() {
  const companies = useLoad<any[]>("/admin/companies", 30000);
  const drivers = useLoad<any[]>("/admin/drivers", 30000);
  const [companyId, setCompanyId] = useState("");
  const load = useCallback((qs: string) => api(`/admin/performance?${qs}${companyId ? `&companyId=${companyId}` : ""}`), [companyId]);
  const scoped = (drivers.data ?? []).filter((d) => !companyId || d.companyId === companyId);
  return (
    <>
      <div className="card filters">
        <span className="cond muted">Société</span>
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Toutes (plateforme)</option>
          {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <PerformanceView
        load={load} scopeKey={companyId}
        drivers={scoped.map((d) => ({ id: d.id, label: `${d.firstName} ${d.lastName}` }))}
        vehicles={scoped.flatMap((d) => d.vehicles.map((v: any) => ({ id: v.id, label: `${v.plate} · ${d.firstName}` })))}
      />
    </>
  );
}

function Companies() {
  const list = useLoad<any[]>("/admin/companies", 10000);
  const [name, setName] = useState("");
  const [siret, setSiret] = useState("");
  const [created, setCreated] = useState<any>(null);
  const [err, setErr] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { setCreated(await api("/admin/companies", { name, siret: siret || undefined })); setErr(""); setName(""); setSiret(""); list.reload(); }
    catch (e: any) { setErr(e.body?.errors ? "SIRET : 14 chiffres" : e.message); }
  }
  return (
    <>
      <h1 className="title">Sociétés</h1>
      <form className="card yel" onSubmit={create}>
        <h3>Nouvelle société partenaire</h3>
        <div className="row">
          <input placeholder="Raison sociale" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 260 }} />
          <input placeholder="SIRET (14 chiffres)" value={siret} onChange={(e) => setSiret(e.target.value)} />
          <button className="btn" disabled={!name}>Créer</button>
        </div>
        {err && <div className="err">{err}</div>}
        {created && <div style={{ marginTop: 14 }}><b>Clé d'accès de l'espace société — à transmettre maintenant, elle ne sera plus affichée :</b><p><code>{created.accessKey}</code></p><p className="muted">Espace société : <code>/societe</code></p></div>}
      </form>
      <div className="grid">
        {list.data?.map((c) => (
          <div className="card" key={c.id}>
            <b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{c.name}</b>
            <div className="muted">{c.siret ?? "SIRET non renseigné"}</div>
            <div className="chips"><span className="chip blue">{c.drivers} chauffeur(s)</span><span className="chip">{c.vehicles} véhicule(s)</span><span className="chip">clé {c.keyPrefix}…</span></div>
          </div>
        ))}
      </div>
    </>
  );
}

function Team() {
  const users = useLoad<any[]>("/admin/users", 15000);
  const [f, setF] = useState({ email: "", name: "", role: "DISPATCHER", password: "" });
  const [err, setErr] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/admin/users", f); setErr(""); setF({ email: "", name: "", role: "DISPATCHER", password: "" }); users.reload(); }
    catch (e: any) { setErr(e.body?.errors?.password?.[0] ?? e.message); }
  }
  async function act(path: string, body: unknown = {}) {
    try { await api(path, body); setErr(""); } catch (e: any) { setErr(e.body?.errors?.password?.[0] ?? e.message); }
    users.reload();
  }
  return (
    <>
      <h1 className="title">Équipe</h1>
      <form className="card yel" onSubmit={add}>
        <h3>Nouveau compte</h3>
        <div className="row">
          <input placeholder="Nom" value={f.name} onChange={set("name")} /><input type="email" placeholder="E-mail" value={f.email} onChange={set("email")} />
          <select value={f.role} onChange={set("role")}><option value="DISPATCHER">Régulateur</option><option value="ADMIN">Administrateur</option></select>
          <input type="password" autoComplete="new-password" placeholder="Mot de passe (12 car. min.)" value={f.password} onChange={set("password")} style={{ minWidth: 240 }} />
          <button className="btn" disabled={!f.name || !f.email || !f.password}>Créer</button>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>Régulateur : courses, attribution, vol, alertes, lecture. Administrateur : tout, y compris partenaires, sociétés, validation des chauffeurs et comptes.</p>
        {err && <div className="err">{err}</div>}
      </form>
      <div className="grid">
        {users.data?.map((u) => (
          <div className="card" key={u.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{u.name}</b>
              <span className={`chip ${u.active ? "ok" : "bad"}`}>{u.active ? (u.role === "ADMIN" ? "Admin" : "Régulateur") : "Désactivé"}</span>
            </div>
            <div className="muted">{u.email}</div>
            <div className="muted">{u.lastLoginAt ? `Dernière connexion : ${dt(u.lastLoginAt)}` : "Jamais connecté"}</div>
            <div className="row" style={{ marginTop: 12 }}>
              {u.active ? <button className="btn danger" onClick={() => act(`/admin/users/${u.id}/deactivate`)}>Désactiver</button> : <button className="btn primary" onClick={() => act(`/admin/users/${u.id}/activate`)}>Réactiver</button>}
              <button className="btn" onClick={() => { const p = window.prompt(`Nouveau mot de passe pour ${u.email} (12 caractères minimum)`); if (p) act(`/admin/users/${u.id}/password`, { password: p }); }}>Réinitialiser</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Account({ user }: { user: AdminSession | null }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/auth/password", { current: cur, next }); setMsg({ ok: true, text: "Mot de passe changé : reconnectez-vous." }); setTimeout(() => { clearToken(); window.dispatchEvent(new Event("vtc-auth-expired")); }, 1200); }
    catch (e: any) { if (e.status !== 401) setMsg({ ok: false, text: e.body?.errors?.password?.[0] ?? e.message }); }
  }
  return (
    <>
      <h1 className="title">Mon compte</h1>
      <form className="card" onSubmit={submit} style={{ maxWidth: 480 }}>
        <p><b>{user?.name}</b><br /><span className="muted">{user?.email} · {user?.role === "ADMIN" ? "Administrateur" : "Régulateur"}</span></p>
        <div className="cond muted">Mot de passe actuel</div>
        <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} style={{ width: "100%", margin: "6px 0 12px" }} />
        <div className="cond muted">Nouveau mot de passe (12 caractères minimum)</div>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={{ width: "100%", margin: "6px 0" }} />
        {msg && <div className={msg.ok ? "" : "err"}>{msg.text}</div>}
        <button className="btn primary" disabled={!cur || !next}>Changer</button>
      </form>
    </>
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
      <h1 className="title">Partenaires</h1>
      <form className="card yel" onSubmit={create}>
        <h3>Nouveau partenaire</h3>
        <div className="row">
          <input placeholder="Nom (ex. une agence de voyage)" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 260 }} />
          <input placeholder="URL webhook (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} style={{ minWidth: 300 }} />
          <button className="btn" disabled={!name}>Créer</button>
        </div>
        {err && <div className="err">{err}</div>}
        {created && (
          <div style={{ marginTop: 14 }}>
            <b>À copier maintenant : ces secrets ne seront plus jamais affichés.</b>
            <p>Clé API (sandbox) : <code>{created.apiKey}</code></p>
            {created.webhookSecret && <p>Secret webhook : <code>{created.webhookSecret}</code></p>}
          </div>
        )}
      </form>
      <div className="card">
        <h3>Courrier sortant (webhooks)</h3>
        <table>
          <thead><tr><th>Date</th><th>Événement</th><th>Statut</th><th>Essais</th><th>Erreur</th></tr></thead>
          <tbody>
            {hooks.data?.map((h) => (
              <tr key={h.id}>
                <td>{dt(h.createdAt)}</td><td>{h.eventType}</td>
                <td><span className={`chip ${h.status === "DELIVERED" ? "ok" : h.status === "FAILED" ? "bad" : ""}`}>{h.status}</span></td>
                <td>{h.attempts}</td><td className="muted">{h.lastError ?? ""}</td>
              </tr>
            ))}
            {!hooks.data?.length && <tr><td colSpan={5} className="muted">Aucun envoi.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AlertsTab() {
  const alerts = useLoad<any[]>("/admin/alerts");
  return (
    <>
      <h1 className="title">Alertes</h1>
      <div className="card">
        <h3>Missions restées sans chauffeur après tous les tours de recherche</h3>
        {alerts.error && <div className="err">{alerts.error}</div>}
        {alerts.data?.length ? (
          <table>
            <thead><tr><th>Prise en charge</th><th>Départ</th><th>Partenaire</th></tr></thead>
            <tbody>{alerts.data.map((a) => <tr key={a.rideId}><td>{dt(a.pickupAt)}</td><td>{a.pickup}</td><td>{a.partner}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted">Aucune alerte. Vous pouvez attribuer à la main depuis le tableau.</p>}
      </div>
    </>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [user, setUserState] = useState<AdminSession | null>(null);
  const [tab, setTab] = useState<Tab>("rides");
  const alerts = useLoad<any[]>("/admin/alerts", 8000);
  const sync = () => { setAuthed(Boolean(getToken())); setUserState(getUser()); };
  useEffect(() => {
    sync(); setReady(true);
    const expired = () => sync();
    window.addEventListener("vtc-auth-expired", expired);
    return () => window.removeEventListener("vtc-auth-expired", expired);
  }, []);
  if (!ready) return null;
  if (!authed) return <Login onOk={sync} />;
  const isAdmin = user?.role === "ADMIN";
  const tabs: [Tab, string][] = [
    ["rides", "Tableau"], ["alerts", "Alertes"], ["perf", "Performance"], ["drivers", "Chauffeurs"],
    ...(isAdmin ? ([["companies", "Sociétés"], ["partners", "Partenaires"], ["team", "Équipe"]] as [Tab, string][]) : []),
    ["account", "Mon compte"],
  ];
  const nAlerts = alerts.data?.length ?? 0;
  return (
    <>
      <header>
        <div className="brand">ÉTOILE<small>tour de contrôle</small></div>
        <nav>
          {tabs.map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {l}{k === "alerts" && nAlerts > 0 && <span className="dot">{nAlerts}</span>}
            </button>
          ))}
        </nav>
        <span style={{ marginLeft: "auto", color: "var(--cream)" }} className="cond">{user?.name}</span>
        <button className="btn" onClick={() => { clearToken(); sync(); }}>Quitter</button>
      </header>
      <main>
        {tab === "rides" && <Board />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "perf" && <AdminPerformance />}
        {tab === "drivers" && <Drivers />}
        {isAdmin && tab === "companies" && <Companies />}
        {isAdmin && tab === "partners" && <Partners />}
        {isAdmin && tab === "team" && <Team />}
        {tab === "account" && <Account user={user} />}
      </main>
    </>
  );
}
