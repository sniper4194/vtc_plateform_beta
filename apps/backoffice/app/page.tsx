"use client";
import { useCallback, useEffect, useState } from "react";
import { adminBlobUrl, api, AdminSession, clearToken, dt, eur, getToken, getUser, login, setToken, setUser } from "../lib/api";
import { PerformanceView } from "./perf";
import { Recruitment } from "./recruitment";

type Tab = "rides" | "alerts" | "perf" | "drivers" | "recruitment" | "companies" | "partners" | "team" | "account";
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

/** Photo de profil du chauffeur (sa photo de référence), chargée à la demande. */
function DriverPhoto({ id }: { id: string }) {
  const [p, setP] = useState<{ photo: string | null; status: string } | null>(null);
  useEffect(() => { api<{ photo: string | null; status: string }>(`/admin/drivers/${id}/photo`).then(setP).catch(() => setP({ photo: null, status: "NONE" })); }, [id]);
  const box = { width: 56, height: 56, borderRadius: 28, border: "2px solid #14172b", flex: "none" as const };
  return p?.photo
    ? <img src={p.photo} alt="Photo du chauffeur" title={p.status === "PENDING" ? "Photo en attente de validation" : "Photo de profil"} style={{ ...box, objectFit: "cover", opacity: p.status === "PENDING" ? 0.6 : 1 }} />
    : <div title="Aucune photo" style={{ ...box, display: "grid", placeItems: "center", background: "#eee", fontSize: 12 }} className="muted">—</div>;
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
      <div className="brand" style={{ fontSize: 64, marginBottom: 24 }}>CliCab<small>tour de contrôle</small></div>
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
  // Retard positif, avance négative (en minutes par rapport à l'atterrissage prévu). L'atterrissage prévu = prise en charge − délai d'attente.
  const landingMs = new Date(ride.pickupAt).getTime() - (ride.flightBufferMin ?? 0) * 60_000;
  async function apply() {
    const m = Number(min);
    if (!Number.isFinite(m)) return onError("Valeur invalide");
    try {
      await api(`/admin/rides/${ride.id}/flight`, { estimatedArrivalAt: m !== 0 ? new Date(landingMs + m * 60_000).toISOString() : null });
      onError(""); setMin(""); onDone();
    } catch (e: any) { onError(e.message); }
  }
  async function set(status: "LANDED" | "CANCELLED") {
    if (status === "CANCELLED" && !window.confirm("Marquer le vol comme annulé ? Le chauffeur est prévenu de ne pas se déplacer ; la mission n'est pas annulée automatiquement.")) return;
    try { await api(`/admin/rides/${ride.id}/flight`, { status }); onError(""); onDone(); } catch (e: any) { onError(e.message); }
  }
  return (
    <>
      <input type="number" placeholder="Retard + / avance − (min)" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Retard (positif) ou avance (négatif) du vol en minutes" />
      <button className="btn" disabled={min === ""} onClick={apply}>Vol</button>
      <button className="btn" onClick={() => set("LANDED")}>Atterri</button>
      <button className="btn danger" onClick={() => set("CANCELLED")}>Annulé</button>
    </>
  );
}

/** Photos-preuves du chauffeur (client absent, bagages en excès) : heure du serveur, distance au lieu de prise en charge, signalements. */
function RideProofs({ rideId }: { rideId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!open) return;
    let stop = false;
    (async () => {
      try {
        const list = await api<any[]>(`/admin/rides/${rideId}/proofs`);
        if (stop) return;
        setItems(list);
        for (const p of list) adminBlobUrl(p.photo).then((u) => !stop && setThumbs((t) => ({ ...t, [p.id]: u }))).catch(() => {});
      } catch (e: any) { setErr(e.message); }
    })();
    return () => { stop = true; };
  }, [open, rideId]);
  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn" onClick={() => setOpen(!open)}>{open ? "Masquer les preuves" : "Preuves du chauffeur"}</button>
      {open && err && <div className="err">{err}</div>}
      {open && items && !items.length && <p className="muted" style={{ margin: "6px 0 0" }}>Aucune photo-preuve.</p>}
      {open && items?.map((p) => (
        <div key={p.id} style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-start" }}>
          {thumbs[p.id]
            ? <a href={thumbs[p.id]} target="_blank" rel="noreferrer"><img src={thumbs[p.id]} alt={p.label} style={{ width: 84, height: 112, objectFit: "cover", border: "2.5px solid var(--ink)", borderRadius: 10 }} /></a>
            : <div style={{ width: 84, height: 112, border: "2.5px dashed var(--ink)", borderRadius: 10 }} />}
          <div style={{ fontSize: 13 }}>
            <b>{p.label}</b>
            <div className="muted">Reçue le {dt(p.receivedAt)} (heure du serveur)</div>
            <div className="muted">à {p.distanceToPickupM} m du lieu de prise en charge · {p.location.lat.toFixed(5)}, {p.location.lng.toFixed(5)}{p.location.accuracyM != null ? ` (±${Math.round(p.location.accuracyM)} m)` : ""}</div>
            {p.location.address && <div className="muted">{p.location.address}</div>}
            {p.note && <div>{p.note}</div>}
            <div className="chips">{p.flags.map((f: any) => <span className="chip bad" key={f.code}>{f.label}</span>)}</div>
            <div className="muted" style={{ fontSize: 11 }}>Empreinte {p.sha256.slice(0, 16)}…</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Board() {
  const rides = useLoad<any[]>("/admin/rides");
  const drivers = useLoad<any[]>("/admin/drivers?status=ACTIVE", 15000);
  const alerts = useLoad<any[]>("/admin/alerts");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [priceOf, setPriceOf] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  async function assign(rideId: string) {
    try {
      const euros = (priceOf[rideId] ?? "").replace(",", ".").trim();
      await api(`/admin/rides/${rideId}/assign`, { driverId: pick[rideId], ...(euros ? { priceCents: Math.round(Number(euros) * 100) } : {}) });
      setErr(""); rides.reload(); alerts.reload(); }
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
                    {r.driverCapCents > 0 && (
                      <div className="chips">
                        <span className="chip">Plafond {eur(r.driverCapCents).replace(",00", "")}</span>
                        {r.driver && <span className="chip">Accepté {eur(r.driverNetCents).replace(",00", "")}</span>}
                        {r.driver && <span className="chip ok">Marge {eur(r.priceCents - r.driverNetCents).replace(",00", "")}</span>}
                      </div>
                    )}
                    {r.booking.flightNumber && (
                      <div className="flightrow">
                        <span className={`chip ${r.flightStatus === "CANCELLED" ? "bad" : r.flightDelayMin > 0 ? "ok" : ""}`}>✈ {r.booking.flightNumber}{r.flightStatus === "CANCELLED" ? " · annulé" : r.flightStatus === "LANDED" ? " · posé" : r.flightDelayMin > 0 ? ` · +${r.flightDelayMin} min` : r.flightStatus === "EARLY" ? ` · −${r.flightEarlyMin} min` : ""}</span>
                        {OPEN_FLIGHT.includes(r.status) && <FlightControl ride={r} onDone={rides.reload} onError={setErr} />}
                      </div>
                    )}
                    {r.driver && <p style={{ margin: "10px 0 0" }}><span className="cond muted">Chauffeur</span><br /><b style={{ fontFamily: "var(--slab)", fontWeight: 400 }}>{r.driver.firstName} {r.driver.lastName}</b></p>}
                    {r.driver && ["ARRIVED", "IN_PROGRESS", "NO_SHOW", "COMPLETED"].includes(r.status) && <RideProofs rideId={r.id} />}
                    {r.status === "DISPATCHING" && (
                      <>
                        <p className="muted" style={{ margin: "10px 0 6px" }}>{pending} offre(s) en circulation</p>
                        {alerted.has(r.id) && <div className="alertbar">⚠ Personne n'a pris la mission : à vous de jouer</div>}
                        <div className="row" style={{ marginTop: 10 }}>
                          <select value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                            <option value="">Attribuer à…</option>
                            {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
                          </select>
                          <input type="text" inputMode="decimal" placeholder="Prix € (auto)" value={priceOf[r.id] ?? ""} onChange={(e) => setPriceOf({ ...priceOf, [r.id]: e.target.value })} style={{ width: 110 }} aria-label="Prix imposé en euros (laisser vide pour le prix du moment)" />
                          <button className="btn primary" disabled={!pick[r.id]} onClick={() => assign(r.id)}>OK</button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
              {!items.length && <div className="card muted" style={{ boxShadow: "none", borderStyle: "dashed", background: "transparent", color: "var(--on-sky)" }}>Rien ici.</div>}
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
              <span className="row" style={{ gap: 12 }}><DriverPhoto id={d.id} /><b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{d.firstName} {d.lastName}</b></span>
              <span className="chips">
                {d.rescueOptIn && <span className="chip blue">Sauveteur</span>}
                {d.rescueRevokedAt && <span className="chip bad">Sauveteur retiré</span>}
                {d.suspendedBy === "auto" && <span className="chip bad">{d.suspendedUntil ? `Suspendu jusqu'au ${dt(d.suspendedUntil)}` : "À examiner (récidive)"}</span>}
                <span className={`chip ${d.status === "ACTIVE" ? "ok" : d.status === "SUSPENDED" ? "bad" : ""}`}>{d.status}</span>
              </span>
            </div>
            <div className="muted">{d.phone}</div>
            <div className="chips">{d.vehicles.map((v: any) => <span className={`chip ${v.compliance?.ok === false ? "bad" : "blue"}`} key={v.id} title={v.compliance?.problems?.join(" · ")}>{v.make} {v.model} · {v.plate}{v.compliance?.ok === false ? " · non conforme" : ""}</span>)}</div>
            {d.vehicles.filter((v: any) => v.compliance?.ok === false).map((v: any) => <div className="muted" key={v.id} style={{ fontSize: 13 }}>{v.plate} : {v.compliance.problems.join(" · ")}</div>)}
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
            {d.status === "ACTIVE" && <button className="btn" style={{ marginLeft: 8 }} onClick={() => act(`/admin/drivers/${d.id}/identity-spot`)}>Demander un selfie</button>}
            {d.status === "ACTIVE" && (d.rescueRevokedAt
              ? <button className="btn" style={{ marginLeft: 8 }} onClick={() => act(`/admin/drivers/${d.id}/rescue-restore`)}>Rétablir le statut sauveteur</button>
              : d.rescueOptIn && <button className="btn" style={{ marginLeft: 8 }} onClick={() => act(`/admin/drivers/${d.id}/rescue-revoke`)}>Retirer le statut sauveteur</button>)}
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

const RESCUE_LABEL: Record<string, string> = { OPEN: "En attente", ACCEPTED: "Reprise", DECLINED: "Refusé", EXPIRED: "Expiré", CANCELLED: "Annulé" };

function AlertsTab() {
  const alerts = useLoad<any[]>("/admin/alerts");
  const rescues = useLoad<any[]>("/admin/rescues", 8000);
  const pens = useLoad<any[]>("/admin/penalties", 15000);
  const inc = useLoad<any[]>("/admin/incidents", 6000);
  async function incAct(id: string, act: "ack" | "close") {
    let body: any = {};
    if (act === "close") { const r = window.prompt("Résolution (visible par le chauffeur) : ex. dépanneuse envoyée, client rappelé"); if (!r) return; body = { resolution: r }; }
    try { await api(`/admin/incidents/${id}/${act}`, body); } catch (e: any) { alert(e.message); }
    inc.reload();
  }
  const ids = useLoad<any[]>("/admin/identity-checks", 15000);
  async function reviewId(id: string, approve: boolean) {
    let reason: string | undefined;
    if (!approve) { reason = window.prompt("Motif du refus (visible par le chauffeur) : ex. photo floue, visage différent de la référence") ?? undefined; if (!reason) return; }
    try { await api(`/admin/identity-checks/${id}/review`, { decision: approve ? "APPROVE" : "REJECT", reason }); } catch (e: any) { alert(e.message); }
    ids.reload();
  }
  async function waive(id: string) {
    const reason = window.prompt("Motif de la dérogation (accident, urgence médicale, justificatif reçu…)");
    if (!reason) return;
    try { await api(`/admin/penalties/${id}/waive`, { reason }); } catch (e: any) { alert(e.message); }
    pens.reload();
  }
  return (
    <>
      <h1 className="title">Alertes</h1>
      <div className="card" style={{ borderColor: inc.data?.some((x) => x.urgent && x.status === "OPEN") ? "#ee2a14" : undefined }}>
        <h3>Incidents signalés par les chauffeurs</h3>
        <p className="muted" style={{ fontSize: 13 }}>Les urgences d'abord. L'équipe n'est pas un service d'urgence : en cas de danger immédiat, le chauffeur est renvoyé vers le 112.</p>
        {inc.error && <div className="err">{inc.error}</div>}
        {inc.data?.length ? (
          <table>
            <thead><tr><th>Heure</th><th>Chauffeur</th><th>Type</th><th>Mission</th><th>Détail</th><th>État</th><th></th></tr></thead>
            <tbody>{inc.data.map((x) => (
              <tr key={x.id}>
                <td>{dt(x.createdAt)}</td>
                <td>{x.driver}<br /><a href={`tel:${x.phone}`}>{x.phone}</a>{x.map && <> · <a href={x.map} target="_blank" rel="noreferrer">carte</a></>}</td>
                <td><span className={`chip ${x.urgent ? "bad" : ""}`}>{x.urgent ? "URGENT · " : ""}{x.label}</span></td>
                <td>{x.ref ? `R-${x.ref}` : "—"}</td><td>{x.message ?? "—"}</td>
                <td><span className={`chip ${x.status === "CLOSED" ? "ok" : x.status === "OPEN" ? "bad" : ""}`}>{x.status === "OPEN" ? "À traiter" : x.status === "ACKNOWLEDGED" ? "Pris en charge" : `Clos${x.resolution ? ` : ${x.resolution}` : ""}`}</span></td>
                <td>{x.status === "OPEN" && <button className="btn primary" onClick={() => incAct(x.id, "ack")}>Prendre en charge</button>}{" "}{x.status !== "CLOSED" && <button className="btn" onClick={() => incAct(x.id, "close")}>Clore</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="muted">Aucun incident.</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Missions sans chauffeur après tous les tours de recherche, et vols annulés</h3>
        {alerts.error && <div className="err">{alerts.error}</div>}
        {alerts.data?.length ? (
          <table>
            <thead><tr><th>Motif</th><th>Prise en charge</th><th>Départ</th><th>Partenaire</th></tr></thead>
            <tbody>{alerts.data.map((a) => <tr key={`${a.reason}-${a.rideId}`}><td><span className="chip bad">{a.reason === "FLIGHT_CANCELLED" ? `Vol ${a.flight ?? ""} annulé` : "Sans chauffeur"}</span></td><td>{dt(a.pickupAt)}</td><td>{a.pickup}</td><td>{a.partner}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted">Aucune alerte. Vous pouvez attribuer à la main depuis le tableau.</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Appels à l'aide des chauffeurs (sauveteurs)</h3>
        {rescues.error && <div className="err">{rescues.error}</div>}
        {rescues.data?.length ? (
          <table>
            <thead><tr><th>Mission</th><th>Prise en charge</th><th>Demandeur</th><th>Motif</th><th>Sauveteur</th><th>État</th></tr></thead>
            <tbody>{rescues.data.map((r) => (
              <tr key={r.id}>
                <td>R-{r.ref}</td><td>{dt(r.pickupAt)}</td><td>{r.requester}</td><td>{r.reason}</td><td>{r.rescuer ?? (r.direct ? "ciblé" : "tous")}</td>
                <td><span className={`chip ${r.status === "ACCEPTED" ? "ok" : r.needsAttention ? "bad" : ""}`}>{r.needsAttention ? "À traiter : sans repreneur" : RESCUE_LABEL[r.status]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="muted">Aucun appel à l'aide.</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Vérifications d'identité (selfies)</h3>
        <p className="muted" style={{ fontSize: 13 }}>Première photo : à comparer avec la pièce d'identité. Selfies de prise de service : à signaler si le visage diffère de la référence (le compte est alors suspendu). Conservation : 30 jours.</p>
        {ids.error && <div className="err">{ids.error}</div>}
        {ids.data?.length ? (
          <table>
            <thead><tr><th>Date</th><th>Chauffeur</th><th>Type</th><th>Selfie</th><th>Référence</th><th>État</th><th></th></tr></thead>
            <tbody>{ids.data.map((x) => (
              <tr key={x.id}>
                <td>{dt(x.createdAt)}</td><td>{x.driver}</td><td>{x.kind === "REFERENCE" ? "Référence" : x.kind === "SPOT" ? "Vérification aléatoire" : "Prise de service"}</td>
                <td>{x.image ? <img src={x.image} alt="Selfie" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: "2px solid #14172b" }} /> : "—"}</td>
                <td>{x.reference ? <img src={x.reference} alt="Référence" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: "2px solid #14172b" }} /> : "—"}</td>
                <td><span className={`chip ${x.status === "VALID" ? "ok" : x.status === "REJECTED" || x.status === "MISSED" ? "bad" : ""}`}>{x.status === "PENDING" ? "À valider" : x.status === "VALID" ? "Valide" : x.status === "REQUESTED" ? `Demandé (avant ${dt(x.dueAt)})` : x.status === "MISSED" ? `Sans réponse${x.missedLast30Days > 1 ? ` · ${x.missedLast30Days} en 30 j` : ""}` : `Refusé${x.reason ? ` (${x.reason})` : ""}`}</span></td>
                <td>
                  {x.status === "PENDING" && <button className="btn primary" onClick={() => reviewId(x.id, true)}>Valider</button>}{" "}
                  {(x.status === "PENDING" || (x.status === "VALID" && x.kind !== "REFERENCE")) && <button className="btn danger" onClick={() => reviewId(x.id, false)}>{x.status === "VALID" ? "Signaler" : "Refuser"}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="muted">Aucun selfie.</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Pénalités chauffeurs (mission rendue ou sauveteur)</h3>
        {pens.error && <div className="err">{pens.error}</div>}
        {pens.data?.length ? (
          <table>
            <thead><tr><th>Date</th><th>Chauffeur</th><th>Mission</th><th>Motif</th><th>Délai</th><th>Montant</th><th>Sanction</th><th></th></tr></thead>
            <tbody>{pens.data.map((p) => (
              <tr key={p.id}>
                <td>{dt(p.createdAt)}</td><td>{p.driver}</td><td>R-{p.ref}</td><td>{p.kind === "RESCUE" ? "Sauveteur" : "Rendue"}</td>
                <td>{p.minutesBefore >= 120 ? `${Math.round(p.minutesBefore / 60)} h` : `${p.minutesBefore} min`}</td>
                <td>{p.waived ? <span className="muted">annulée ({p.waiveReason})</span> : (p.amountCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
                <td>{p.sanction ? <span className="chip bad">{p.sanction}</span> : "—"}</td>
                <td>{!p.waived && <button className="btn" onClick={() => waive(p.id)}>Annuler</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="muted">Aucune pénalité.</p>}
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
  const rescues = useLoad<any[]>("/admin/rescues?open=1", 8000);
  const pendingIds = useLoad<any[]>("/admin/identity-checks?status=PENDING", 8000);
  const openInc = useLoad<any[]>("/admin/incidents?status=OPEN", 6000);
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
    ...(isAdmin ? ([["recruitment", "Recrutement"], ["companies", "Sociétés"], ["partners", "Partenaires"], ["team", "Équipe"]] as [Tab, string][]) : []),
  ];
  const nAlerts = (alerts.data?.length ?? 0) + (rescues.data?.length ?? 0) + (pendingIds.data?.length ?? 0) + (openInc.data?.length ?? 0);
  return (
    <>
      <header>
        <div className="brand">CliCab<small>tour de contrôle</small></div>
        <nav>
          {tabs.map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {l}{k === "alerts" && nAlerts > 0 && <span className="dot">{nAlerts}</span>}
            </button>
          ))}
        </nav>
        <button className={`btn ${tab === "account" ? "primary" : ""}`} style={{ marginLeft: "auto", whiteSpace: "nowrap" }} onClick={() => setTab("account")} title="Mon compte">{user?.name}</button>
        <button className="btn" onClick={() => { clearToken(); sync(); }}>Quitter</button>
      </header>
      <main>
        {tab === "rides" && <Board />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "perf" && <AdminPerformance />}
        {tab === "drivers" && <Drivers />}
        {isAdmin && tab === "recruitment" && <Recruitment />}
        {isAdmin && tab === "companies" && <Companies />}
        {isAdmin && tab === "partners" && <Partners />}
        {isAdmin && tab === "team" && <Team />}
        {tab === "account" && <Account user={user} />}
      </main>
    </>
  );
}
