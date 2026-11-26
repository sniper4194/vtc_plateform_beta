"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { capi, clearCompanyKey, downloadCompanyFile, dt, eur, getCompanyKey, setCompanyKey } from "../../lib/api";
import { PerformanceView } from "../perf";
import "../regulator-theme.css";
import { ThemePicker, useSiteTheme } from "../theme";

type Tab = "perf" | "drivers" | "vehicles" | "rides" | "pool" | "payments";

function useLoad<T>(path: string, every = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => { try { setData(await capi<T>(path)); setError(""); } catch (e: any) { setError(e.message); } }, [path]);
  useEffect(() => { reload(); const t = setInterval(reload, every); return () => clearInterval(t); }, [reload, every]);
  return { data, error, reload };
}

function Login({ onOk, picker }: { onOk: () => void; picker: ReactNode }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCompanyKey(key.trim());
    try { await capi("/company/me"); onOk(); } catch (e: any) { clearCompanyKey(); setErr(e.status === 401 ? "Clé invalide" : e.message); }
  }
  return (
    <main className="regulator-login">
      <div className="brand">CliCab<small>espace société</small></div>
      <form className="card" onSubmit={submit}>
        <div className="cond muted">Clé d'accès de votre société</div>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="cmp_…" style={{ width: "100%", margin: "8px 0" }} autoFocus />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={!key}>Entrer</button>
      </form>
      {picker}
    </main>
  );
}

function Drivers() {
  const drivers = useLoad<any[]>("/company/drivers");
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", email: "", plate: "", make: "", model: "", category: "BERLINE" });
  const [msg, setMsg] = useState("");
  async function act(path: string) {
    try { await capi(path, {}); setMsg(""); } catch (e: any) { setMsg(e.body?.missing ? `${e.message} : ${e.body.missing.join(", ")}` : e.message); }
    drivers.reload();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { plate, make, model, category, ...p } = f;
    try { await capi("/company/drivers", { ...p, vehicle: plate ? { plate, make, model, category } : undefined }); setMsg(""); setF({ ...f, firstName: "", lastName: "", phone: "", email: "", plate: "" }); drivers.reload(); }
    catch (e: any) { setMsg(e.message); }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <h1 className="title">Chauffeurs</h1>
      <form className="card yel" onSubmit={add}>
        <h3>Ajouter un chauffeur</h3>
        <div className="row">
          <input placeholder="Prénom" value={f.firstName} onChange={set("firstName")} /><input placeholder="Nom" value={f.lastName} onChange={set("lastName")} />
          <input placeholder="Téléphone" value={f.phone} onChange={set("phone")} /><input placeholder="E-mail" value={f.email} onChange={set("email")} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="Plaque (optionnel)" value={f.plate} onChange={set("plate")} /><input placeholder="Marque" value={f.make} onChange={set("make")} /><input placeholder="Modèle" value={f.model} onChange={set("model")} />
          <select value={f.category} onChange={set("category")}><option>BERLINE</option><option>BUSINESS</option><option>VAN</option><option>GREEN</option></select>
          <button className="btn" disabled={!f.firstName || !f.phone || !f.email}>Ajouter</button>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>Le chauffeur dépose ses documents depuis l'app ; la plateforme les valide.</p>
      </form>
      {(drivers.error || msg) && <div className="card redbg">{drivers.error || msg}</div>}
      <div className="grid">
        {drivers.data?.map((d) => (
          <div className="card" key={d.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{d.firstName} {d.lastName}</b>
              <span className={`chip ${d.status === "ACTIVE" ? "ok" : d.status === "SUSPENDED" ? "bad" : ""}`}>{d.status}</span>
            </div>
            <div className="muted">{d.phone}</div>
            <div className="chips">{d.vehicles.map((v: any) => <span className="chip blue" key={v.id}>{v.plate}</span>)}</div>
            {d.missingDocuments.length > 0 && <p className="err" style={{ margin: "10px 0 0" }}>Documents manquants : {d.missingDocuments.join(", ")}</p>}
            <div style={{ marginTop: 12 }}>
              {d.status === "ACTIVE" && <button className="btn danger" onClick={() => act(`/company/drivers/${d.id}/suspend`)}>Suspendre</button>}
              {d.status === "SUSPENDED" && <button className="btn primary" onClick={() => act(`/company/drivers/${d.id}/resume`)}>Réactiver</button>}
            </div>
          </div>
        ))}
      </div>
      {!drivers.data?.length && <div className="card">Aucun chauffeur pour l'instant.</div>}
    </>
  );
}

function Vehicles() {
  const vehicles = useLoad<any[]>("/company/vehicles");
  const drivers = useLoad<any[]>("/company/drivers", 30000);
  const [f, setF] = useState({ plate: "", make: "", model: "", category: "BERLINE", seats: "4", driverId: "" });
  const [err, setErr] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await capi("/company/vehicles", { ...f, seats: Number(f.seats), driverId: f.driverId || undefined }); setErr(""); setF({ ...f, plate: "" }); vehicles.reload(); }
    catch (e: any) { setErr(e.message); }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <h1 className="title">Véhicules</h1>
      <form className="card yel" onSubmit={add}>
        <h3>Ajouter un véhicule</h3>
        <div className="row">
          <input placeholder="Plaque" value={f.plate} onChange={set("plate")} /><input placeholder="Marque" value={f.make} onChange={set("make")} /><input placeholder="Modèle" value={f.model} onChange={set("model")} />
          <select value={f.category} onChange={set("category")}><option>BERLINE</option><option>BUSINESS</option><option>VAN</option><option>GREEN</option></select>
          <input type="number" min={1} max={9} value={f.seats} onChange={set("seats")} style={{ width: 80 }} aria-label="Places" />
          <select value={f.driverId} onChange={set("driverId")}><option value="">Sans chauffeur</option>{drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}</select>
          <button className="btn" disabled={!f.plate || !f.make || !f.model}>Ajouter</button>
        </div>
        {err && <div className="err">{err}</div>}
      </form>
      <div className="grid">
        {vehicles.data?.map((v) => (
          <div className="card" key={v.id}>
            <b style={{ fontFamily: "var(--slab)", fontWeight: 400, fontSize: 18 }}>{v.plate}</b>
            <div>{v.make} {v.model}</div>
            <div className="chips"><span className="chip blue">{v.category}</span><span className="chip">{v.seats} places</span><span className="chip">{v.driver ? `${v.driver.firstName} ${v.driver.lastName}` : "non affecté"}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}

function Pool() {
  const b = useLoad<any>("/company/pool", 15000);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const d = b.data;
  async function run(fn: () => Promise<any>, ok: string) { try { await fn(); setMsg(ok); } catch (e: any) { setMsg(e.message); } b.reload(); }
  if (!d) return <div className="card muted">{b.error || "Chargement…"}</div>;
  return (
    <>
      <h1 className="title">Mise en commun</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Confiez une mission que vous ne pouvez pas assurer à une autre société partenaire, ou prenez celles des autres. C'est réciproque : il faut être inscrit pour confier comme pour recevoir.
          Possible jusqu'à {d.minHours} h avant la prise en charge. Part du net reversée à la société d'origine : <b>{d.sharePercent} %</b>, annoncée avant d'accepter. Aucune pénalité.
        </p>
        <button className={`btn ${d.optIn ? "" : "primary"}`} onClick={() => run(() => capi("/company/pool/opt-in", { enabled: !d.optIn }), d.optIn ? "Vous ne participez plus à la mise en commun" : "Inscription enregistrée")}>
          {d.optIn ? "Ne plus participer" : "Participer à la mise en commun"}
        </button>
        {msg && <p className="muted">{msg}</p>}
      </div>
      {d.optIn && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Missions proposées par d'autres sociétés</h3>
          {!d.available.length && <p className="muted">Aucune pour le moment.</p>}
          {d.available.map((p: any) => (
            <div key={p.id} className="row" style={{ borderTop: "2px solid var(--ink)", paddingTop: 10, marginTop: 10, justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 260, flex: 1 }}>
                <b>{dt(p.ride.pickupAt)} · R-{p.ride.ref}</b> <span className="chip">{p.ride.category}</span>
                <div>{p.ride.pickup} <span className="muted">→ {p.ride.dropoff}</span></div>
                <div className="muted" style={{ fontSize: 13 }}>
                  De {p.fromCompany} · net {eur(p.ride.baseNetCents)}{p.shareCents > 0 ? ` − part reversée ${eur(p.shareCents)} (${p.sharePercent} %)` : ""} · {Math.round(p.ride.distanceKm)} km
                  {p.ride.needs?.length ? ` · besoins : ${p.ride.needs.join(", ")}` : ""}
                </div>
              </div>
              {p.drivers.length ? (
                <div className="row">
                  <select value={pick[p.id] ?? ""} onChange={(e) => setPick({ ...pick, [p.id]: e.target.value })} aria-label="Chauffeur">
                    <option value="">Choisir un chauffeur…</option>
                    {p.drivers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <button className="btn primary" disabled={!pick[p.id]} onClick={() => run(() => capi(`/company/pool/${p.id}/take`, { driverId: pick[p.id] }), `Mission R-${p.ride.ref} attribuée`)}>Prendre</button>
                </div>
              ) : <span className="muted">Aucun de vos chauffeurs n'est disponible et équipé.</span>}
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Vos missions confiées</h3>
        {!d.given.length && <p className="muted">Aucune. Pour confier une mission, utilisez le bouton « Confier » dans l'onglet Missions.</p>}
        <table>
          <tbody>
            {d.given.map((p: any) => (
              <tr key={p.id}>
                <td>{dt(p.ride.pickupAt)} · R-{p.ride.ref}</td><td>{p.ride.pickup} → {p.ride.dropoff}</td>
                <td><span className={`chip ${p.status === "TAKEN" ? "ok" : ""}`}>{p.status === "OPEN" ? "En attente" : p.status === "TAKEN" ? `Prise par ${p.toCompany}` : "Annulée"}</span></td>
                <td>{p.status === "TAKEN" && p.shareCents > 0 ? `+ ${eur(p.shareCents)}` : ""}</td>
                <td>{p.status === "OPEN" && <button className="btn" onClick={() => run(() => capi(`/company/pool/${p.id}/cancel`, {}), "Proposition retirée")}>Retirer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Rides({ drivers }: { drivers: any[] }) {
  const [driverId, setDriverId] = useState("");
  const [msg, setMsg] = useState("");
  async function give(id: string) { try { await capi("/company/pool", { rideId: id }); setMsg("Mission proposée aux sociétés partenaires (onglet Mise en commun)"); } catch (e: any) { setMsg(e.message); } }
  // 30 jours passés ET 30 jours à venir : les missions à venir sont celles qu'on peut confier. Bornes figées au montage.
  const [range] = useState(() => `from=${encodeURIComponent(new Date(Date.now() - 30 * 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86400_000).toISOString())}`);
  const rides = useLoad<any[]>(`/company/rides?${range}${driverId ? `&driverId=${driverId}` : ""}`);
  return (
    <>
      <h1 className="title">Missions</h1>
      <div className="card filters">
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}><option value="">Tous les chauffeurs</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}</select>
        <span className="muted">30 jours avant et après aujourd'hui</span>
      </div>
      {msg && <div className="card">{msg}</div>}
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Prise en charge</th><th>Trajet</th><th>Chauffeur</th><th>Vol</th><th>Statut</th><th>Net</th><th></th></tr></thead>
          <tbody>
            {rides.data?.map((r) => (
              <tr key={r.id}>
                <td>{dt(r.pickupAt)}</td><td>{r.pickup}<br /><span className="muted">→ {r.dropoff}</span></td><td>{r.driver ?? "—"}<br /><span className="muted">{r.plate}</span></td>
                <td>{r.flight ? `✈ ${r.flight}${r.flightDelayMin ? ` +${r.flightDelayMin} min` : ""}` : "—"}</td>
                <td><span className={`chip ${r.status === "COMPLETED" ? "ok" : ["NO_SHOW", "DISPUTED"].includes(r.status) ? "bad" : ""}`}>{r.status}</span></td><td>{eur(r.netCents)}</td>
                <td>{r.status === "ASSIGNED" && new Date(r.pickupAt).getTime() > Date.now() && <button className="btn" title="Confier à une société partenaire" onClick={() => give(r.id)}>Confier</button>}</td>
              </tr>
            ))}
            {!rides.data?.length && <tr><td colSpan={7} className="muted">Aucune mission sur la période.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Payments() {
  const stmt = useLoad<any>("/company/payments", 15000);
  const [err, setErr] = useState("");
  const d = stmt.data;
  return (
    <>
      <h1 className="title">Relevé de paiements</h1>
      {(stmt.error || err) && <div className="card redbg">{stmt.error || err}</div>}
      {d && (
        <>
          <div className="kpis">
            <div className="sticker s1" style={{ width: 170, height: 170 }}><span className="cond">Net à percevoir</span><b style={{ fontSize: 34 }}>{eur(d.totals.netCents).replace(",00", "")}</b><span className="cond">15 derniers jours</span></div>
            <div className="sticker s3"><span className="cond">Missions</span><b>{d.totals.rides}</b>{d.totals.cancellations > 0 && <span className="cond muted">+{d.totals.cancellations} annulation(s)</span>}</div>
            <div className="sticker s2"><span className="cond">Commission</span><b style={{ fontSize: 30 }}>{eur(d.totals.commissionCents).replace(",00", "")}</b></div>
            <button className="btn primary" onClick={() => downloadCompanyFile("/company/payments.csv", "releve-paiements.csv").catch((e) => setErr(e.message))}>Télécharger le CSV</button>
          </div>
          <div className="card">
            <h3>Par chauffeur</h3>
            <table><thead><tr><th>Chauffeur</th><th>Missions</th><th>Net</th></tr></thead>
              <tbody>{d.byDriver.map((x: any) => <tr key={x.driverId}><td>{x.driver}</td><td>{x.rides}</td><td>{eur(x.netCents)}</td></tr>)}
                {!d.byDriver.length && <tr><td colSpan={3} className="muted">Aucune mission terminée sur la période.</td></tr>}</tbody></table>
          </div>
          <div className="card" style={{ overflowX: "auto" }}>
            <h3>Détail</h3>
            <table><thead><tr><th>Date</th><th>Réf.</th><th>Chauffeur</th><th>Brut</th><th>Commission</th><th>Net</th></tr></thead>
              <tbody>{d.rows.map((r: any) => <tr key={`${r.kind}-${r.rideId}-${r.at}`}><td>{dt(r.pickupAt)}</td><td>{r.kind === "ANNULATION" && <span className="chip bad">Annulation</span>}{r.kind === "PENALITE" && <span className="chip bad">Pénalité</span>} {r.reference ?? "—"}</td><td>{r.driver}</td><td>{eur(r.grossCents)}</td><td>{eur(r.commissionCents)}</td><td>{eur(r.netCents)}</td></tr>)}</tbody></table>
          </div>
        </>
      )}
    </>
  );
}

export default function CompanyPortal() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("perf");
  const [theme, changeTheme] = useSiteTheme();
  const me = useLoad<any>("/company/me", 60000);
  const drivers = useLoad<any[]>("/company/drivers", 30000);
  useEffect(() => { setAuthed(Boolean(getCompanyKey())); setReady(true); }, []);
  const loadPerf = useCallback((qs: string) => capi(`/company/performance?${qs}`), []);
  if (!ready) return null;
  const picker = <ThemePicker theme={theme} onTheme={changeTheme} label="Thème de l'espace société" />;
  if (!authed) return <div className="regulator regulator-signed-out" data-theme={theme}><Login onOk={() => setAuthed(true)} picker={picker} /></div>;
  const tabs: [Tab, string][] = [["perf", "Performance"], ["drivers", "Chauffeurs"], ["vehicles", "Véhicules"], ["rides", "Missions"], ["pool", "Mise en commun"], ["payments", "Paiements"]];
  return (
    <div className="regulator" data-theme={theme}>
      <header>
        <div className="brand">CliCab<small>{me.data?.name ?? "espace société"}</small></div>
        <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <span style={{ marginLeft: "auto" }}>{picker}</span>
        <button className="btn" onClick={() => { clearCompanyKey(); setAuthed(false); }}>Quitter</button>
      </header>
      <main>
        {tab === "perf" && <PerformanceView load={loadPerf} drivers={(drivers.data ?? []).map((d) => ({ id: d.id, label: `${d.firstName} ${d.lastName}` }))} vehicles={(drivers.data ?? []).flatMap((d) => d.vehicles.map((v: any) => ({ id: v.id, label: `${v.plate} · ${d.firstName}` })))} />}
        {tab === "drivers" && <Drivers />}
        {tab === "vehicles" && <Vehicles />}
        {tab === "rides" && <Rides drivers={drivers.data ?? []} />}
        {tab === "pool" && <Pool />}
        {tab === "payments" && <Payments />}
      </main>
    </div>
  );
}
