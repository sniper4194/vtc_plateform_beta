"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORY, NEED, parisToIso } from "../../lib/hosted";
import { CANCELLABLE, carePassengers, DONE, HOTEL_KEY, rangeText, looksLikeKey, parisDateTime, parisMonth, paymentLabel, shiftMonth, statementCsv, STATUS, type HotelRow } from "../../lib/hotel";
import { API_URL } from "../../lib/tracking";

type Features = { room: boolean; caseNumber: boolean; brokenPlate: boolean; asap: boolean; returnTrip: boolean; department: boolean; escorts: boolean; walkingAssist: boolean };
type Session = { name: string; range: string | null; space: string; rangeLabel: string | null; addressMode: "hub" | "free"; features: Features; asapLeadMin: number;
  place: { label: string; address: string } | null; hubs: { id: string; label: string; airport: boolean }[]; categories: string[]; needs: string[] };
type Quote = { quoteId: string; total: number; distanceKm: number; durationMin: number; pickup: string; dropoff: string; pickupAt?: string; return?: { quoteId: string; total: number; pickupAt: string } };
type List = { month: string; rows: HotelRow[]; totals: { billed: number; onBoard: number; unpaidOnBoard: number; cancellationFees: number } };

const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL ?? "https://clicab.fr/confidentialite.html";
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

function readKey(): string {
  try { return sessionStorage.getItem(HOTEL_KEY) ?? localStorage.getItem(HOTEL_KEY) ?? ""; } catch { return ""; }
}
function storeKey(key: string, remember: boolean) {
  try { (remember ? localStorage : sessionStorage).setItem(HOTEL_KEY, key); } catch { /* la session reste en mémoire */ }
}
function forgetKey() {
  try { sessionStorage.removeItem(HOTEL_KEY); localStorage.removeItem(HOTEL_KEY); } catch { /* rien à effacer */ }
}

/** Espace hôtel : la réception commande et suit les transferts de ses clients (tablette ou ordinateur). */
export default function Hotel() {
  const [key, setKey] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const call = useCallback(async <R,>(path: string, opts: { method?: string; body?: unknown; idem?: string; with?: string } = {}): Promise<R> => {
    let r: Response;
    try {
      r = await fetch(`${API_URL}${path}`, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), cache: "no-store",
        headers: { authorization: `Bearer ${opts.with ?? key}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...(opts.idem ? { "idempotency-key": opts.idem } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch { throw new ApiError("Connexion impossible : vérifiez Internet et réessayez.", 0); }
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const first = j?.errors ? Object.values(j.errors as Record<string, string[]>)[0]?.[0] : null;
      throw new ApiError(r.status === 401 ? "Clé refusée ou désactivée." : first ?? j?.message ?? `Erreur ${r.status}`, r.status);
    }
    return j as R;
  }, [key]);

  // Reprise de la session enregistrée sur cet appareil.
  useEffect(() => {
    const saved = readKey();
    if (!saved) { setReady(true); return; }
    call<Session>("/v1/hotel/session", { with: saved }).then((s) => { setKey(saved); setSession(s); }).catch((e) => { if (e.status === 401) forgetKey(); }).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function logout() { forgetKey(); setKey(""); setSession(null); }

  if (!ready) return <main className="wrap"><div className="brand">CliCab</div><p className="muted">…</p></main>;
  if (!session) return <Login call={call} onOk={(k, s, remember) => { storeKey(k, remember); setKey(k); setSession(s); }} />;
  return (
    <main className="wrap wide" style={{ borderTop: `8px solid ${rangeText(session.range).color}` }}>
      <div className="hotel-head">
        <div><div className="brand">CliCab</div><h1>{session.name}</h1><p className="muted">{session.rangeLabel ? <span className="hotel-range" style={{ background: rangeText(session.range).color, color: session.range === "HOTEL" ? "#14172b" : "#fff" }}>{session.rangeLabel}</span> : null}{session.space}{session.place ? ` · ${session.place.address}` : ""}</p><p className="small">{rangeText(session.range).intro}</p></div>
        <button type="button" className="link" onClick={logout}>Se déconnecter</button>
      </div>
      <div className="hotel-grid">
        <Order session={session} call={call} />
        <Rides call={call} onRevoked={logout} billed={rangeText(session.range).billed} />
      </div>
    </main>
  );
}

type Call = <R>(path: string, opts?: { method?: string; body?: unknown; idem?: string; with?: string }) => Promise<R>;

function Login({ call, onOk }: { call: Call; onOk: (key: string, s: Session, remember: boolean) => void }) {
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const k = draft.trim();
    if (!looksLikeKey(k)) { setErr("Cette clé n'a pas le bon format (elle commence par vtc_live_ ou vtc_test_)."); return; }
    setBusy(true);
    try { onOk(k, await call<Session>("/v1/hotel/session", { with: k }), remember); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <main className="wrap">
      <div className="brand">CliCab</div>
      <form className="card" onSubmit={submit}>
        <h1>Espace partenaire</h1>
        <p className="muted">Hôtels, garages et assurances, associations, établissements de santé : commandez les trajets de vos clients et suivez-les en direct.</p>
        <label className="field"><span>Clé de l'établissement</span>
          <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="vtc_live_…" /></label>
        <p className="small">Fournie par CliCab. Ne la communiquez qu'au personnel de la réception.</p>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Rester connecté sur cet appareil (seulement sur un appareil de la réception, jamais sur un appareil personnel ou public)</span></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy || !draft.trim()}>{busy ? "Vérification…" : "Ouvrir l'espace"}</button>
      </form>
    </main>
  );
}

const EMPTY_TRIP = { direction: "TO_HUB", hub: "CDG-T2", date: "", time: "", category: "BERLINE", passengers: "1", luggage: "1", flightNumber: "",
  from: "", to: "", asap: false, roundTrip: false, backDate: "", backTime: "", escorts: "0" };
const EMPTY_PAX = { firstName: "", lastName: "", phone: "", email: "", room: "", notes: "", consent: false, language: "fr",
  caseNumber: "", brokenPlate: "", department: "", walkingAssist: false };

function Order({ session, call }: { session: Session; call: Call }) {
  const [trip, setTrip] = useState(EMPTY_TRIP);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pax, setPax] = useState(EMPTY_PAX);
  const [needs, setNeeds] = useState<string[]>([]);
  const [payOnBoard, setPayOnBoard] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; total: number; return?: { reference: string; total: number } } | null>(null);
  const idem = useRef("");
  const f = session.features;
  const free = session.addressMode === "free";
  const text = rangeText(session.range);
  const hub = session.hubs.find((h) => h.id === trip.hub);
  const setT = (k: keyof typeof trip, v: string | boolean) => { setTrip({ ...trip, [k]: v }); setQuote(null); };
  const withFlight = !free && hub?.airport && trip.direction === "FROM_HUB";
  const passengers = f.escorts ? carePassengers(trip.escorts) : Number(trip.passengers) || 1;

  if (!free && !session.place) return <section className="card"><h2>Nouvelle commande</h2><p className="err">L'adresse de votre établissement n'est pas encore enregistrée. Contactez CliCab pour l'ajouter.</p></section>;

  async function getQuote(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setDone(null);
    const asap = free && f.asap && trip.asap;
    const pickupAt = asap ? null : parisToIso(trip.date, trip.time);
    if (!asap && !pickupAt) { setErr("Date ou heure invalide."); return; }
    const returnAt = free && f.returnTrip && trip.roundTrip ? parisToIso(trip.backDate || trip.date, trip.backTime) : null;
    if (free && f.returnTrip && trip.roundTrip && !returnAt) { setErr("Heure de retour invalide."); return; }
    setBusy(true);
    try {
      const common = { category: trip.category, passengers, luggage: Number(trip.luggage) || 0 };
      setQuote(await call<Quote>("/v1/hotel/quote", { body: free
        ? { pickupAddress: trip.from, dropoffAddress: trip.to, ...(asap ? { asap: true } : { pickupAt }), ...(returnAt ? { returnAt } : {}), ...common }
        : { hub: trip.hub, direction: trip.direction, pickupAt, ...common, ...(withFlight && trip.flightNumber.trim() ? { flightNumber: trip.flightNumber.replace(/\s/g, "") } : {}) } }));
      idem.current = crypto.randomUUID();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }

  async function book(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!quote) return;
    const details = {
      ...(f.caseNumber && pax.caseNumber.trim() ? { caseNumber: pax.caseNumber.trim() } : {}),
      ...(f.brokenPlate && pax.brokenPlate.trim() ? { brokenPlate: pax.brokenPlate.trim() } : {}),
      ...(f.department && pax.department.trim() ? { department: pax.department.trim() } : {}),
      ...(f.escorts && passengers > 1 ? { escorts: passengers - 1 } : {}),
      ...(f.walkingAssist && pax.walkingAssist ? { walkingAssist: true } : {}),
    };
    setBusy(true);
    try {
      const b = await call<{ reference: string; total: number; return?: { reference: string; total: number } }>("/v1/hotel/bookings", { idem: idem.current, body: {
        quoteId: quote.quoteId, ...(quote.return ? { returnQuoteId: quote.return.quoteId } : {}), consent: pax.consent, needs, details,
        ...(free && f.asap && trip.asap ? { asap: true } : {}), ...(payOnBoard ? { payOnBoard: true } : {}),
        ...(f.room && pax.room.trim() ? { room: pax.room.trim() } : {}), ...(pax.notes.trim() ? { notes: pax.notes.trim() } : {}),
        passenger: { firstName: pax.firstName, lastName: pax.lastName, phone: pax.phone, ...(pax.email.trim() ? { email: pax.email.trim() } : {}), language: pax.language },
      } });
      setDone(b); setQuote(null); setTrip(EMPTY_TRIP); setPax(EMPTY_PAX); setNeeds([]); setPayOnBoard(false);
      window.dispatchEvent(new Event("hotel-booked"));
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }

  return (
    <section>
      {done && <div className="card hotel-done" role="status"><h2>Course commandée</h2><p><b>{done.reference}</b> · {eur(done.total)}{done.return ? <> · retour <b>{done.return.reference}</b> · {eur(done.return.total)}</> : null}. Le {text.person} reçoit le lien de suivi par SMS.</p></div>}
      <form className="card" onSubmit={getQuote} noValidate>
        <h2>Nouvelle commande</h2>
        {free ? (
          <>
            <datalist id="hubs">{session.hubs.map((h) => <option key={h.id} value={h.label} />)}</datalist>
            <label className="field"><span>Adresse de départ</span><input list="hubs" autoComplete="off" placeholder="Numéro, rue, ville" value={trip.from} onChange={(e) => setT("from", e.target.value)} /></label>
            <label className="field"><span>Adresse d'arrivée</span><input list="hubs" autoComplete="off" placeholder="Numéro, rue, ville" value={trip.to} onChange={(e) => setT("to", e.target.value)} /></label>
            <p className="small">Aéroports et gares proposés en raccourci. Les adresses sont vérifiées avant le prix : contrôlez-les sur le devis.</p>
            {f.asap && <label className="check"><input type="checkbox" checked={trip.asap} onChange={(e) => setT("asap", e.target.checked)} /><span><b>Dès que possible</b> : le {text.person} attend, prise en charge dans environ {session.asapLeadMin} min</span></label>}
          </>
        ) : (
          <>
            <fieldset className="field"><legend>Trajet</legend>
              <label className="check"><input type="radio" name="dir" checked={trip.direction === "TO_HUB"} onChange={() => setT("direction", "TO_HUB")} /><span>Départ de l'hôtel vers un aéroport ou une gare</span></label>
              <label className="check"><input type="radio" name="dir" checked={trip.direction === "FROM_HUB"} onChange={() => setT("direction", "FROM_HUB")} /><span>Arrivée : d'un aéroport ou d'une gare vers l'hôtel</span></label>
            </fieldset>
            <label className="field"><span>Aéroport ou gare</span>
              <select value={trip.hub} onChange={(e) => setT("hub", e.target.value)}>{session.hubs.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}</select></label>
          </>
        )}
        {!(free && f.asap && trip.asap) && <div className="two">
          <label className="field" style={{ margin: 0 }}><span>Date</span><input type="date" value={trip.date} onChange={(e) => setT("date", e.target.value)} /></label>
          <label className="field" style={{ margin: 0 }}><span>Heure (Paris)</span><input type="time" value={trip.time} onChange={(e) => setT("time", e.target.value)} /></label>
        </div>}
        {free && f.returnTrip && <>
          <label className="check"><input type="checkbox" checked={trip.roundTrip} onChange={(e) => setT("roundTrip", e.target.checked)} /><span><b>Aller-retour</b> : le retour part de l'adresse d'arrivée</span></label>
          {trip.roundTrip && <div className="two">
            <label className="field" style={{ margin: 0 }}><span>Date du retour</span><input type="date" value={trip.backDate || trip.date} onChange={(e) => setT("backDate", e.target.value)} /></label>
            <label className="field" style={{ margin: 0 }}><span>Heure du retour</span><input type="time" value={trip.backTime} onChange={(e) => setT("backTime", e.target.value)} /></label>
          </div>}
        </>}
        <label className="field"><span>Véhicule</span>
          <select value={trip.category} onChange={(e) => setT("category", e.target.value)}>{session.categories.map((c) => <option key={c} value={c}>{CATEGORY.fr[c] ?? c}</option>)}</select></label>
        <div className="two">
          {f.escorts
            ? <label className="field" style={{ margin: 0 }}><span>Accompagnants</span><select value={trip.escorts} onChange={(e) => setT("escorts", e.target.value)}>{["0", "1", "2", "3"].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            : <label className="field" style={{ margin: 0 }}><span>Passagers</span><input inputMode="numeric" value={trip.passengers} onChange={(e) => setT("passengers", e.target.value.replace(/\D/g, ""))} /></label>}
          <label className="field" style={{ margin: 0 }}><span>Bagages</span><input inputMode="numeric" value={trip.luggage} onChange={(e) => setT("luggage", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        {withFlight && <label className="field"><span>Numéro de vol (facultatif)</span><input value={trip.flightNumber} placeholder="AF1234" autoCapitalize="characters" onChange={(e) => setT("flightNumber", e.target.value.toUpperCase())} /></label>}
        {!quote && <button className="primary" disabled={busy || (free && (trip.from.trim().length < 5 || trip.to.trim().length < 5))}>{busy ? "Calcul…" : "Voir le prix"}</button>}
        {err && !quote && <p className="err" role="alert">{err}</p>}
      </form>

      {quote && (
        <form className="card" onSubmit={book} noValidate>
          <h2>Prix fixe</h2>
          <h1 style={{ margin: 0 }}>{eur(quote.total + (quote.return?.total ?? 0))}</h1>
          <p className="small"><b>Départ :</b> {quote.pickup}<br /><b>Arrivée :</b> {quote.dropoff}<br />{quote.distanceKm} km · ~{quote.durationMin} min{quote.pickupAt ? ` · prise en charge ${parisDateTime(quote.pickupAt)}` : ""}</p>
          {quote.return && <p className="small">Aller {eur(quote.total)} + retour {eur(quote.return.total)} le {parisDateTime(quote.return.pickupAt)}</p>}
          <button type="button" className="link" onClick={() => setQuote(null)}>Modifier le trajet</button>
          <div className="two">
            <label className="field" style={{ margin: 0 }}><span>Prénom du {text.person}</span><input value={pax.firstName} onChange={(e) => setPax({ ...pax, firstName: e.target.value })} /></label>
            {f.room && <label className="field" style={{ margin: 0 }}><span>Chambre</span><input value={pax.room} maxLength={20} onChange={(e) => setPax({ ...pax, room: e.target.value })} /></label>}
          </div>
          <label className="field"><span>Nom du {text.person}</span><input value={pax.lastName} onChange={(e) => setPax({ ...pax, lastName: e.target.value })} /></label>
          <label className="field"><span>Téléphone portable du {text.person} (reçoit le lien de suivi)</span><input type="tel" placeholder="+33 6 12 34 56 78" value={pax.phone} onChange={(e) => setPax({ ...pax, phone: e.target.value })} /></label>
          <label className="field"><span>E-mail (facultatif)</span><input type="email" value={pax.email} onChange={(e) => setPax({ ...pax, email: e.target.value })} /></label>
          {f.caseNumber && <label className="field"><span>N° de dossier ou de sinistre</span><input value={pax.caseNumber} maxLength={40} onChange={(e) => setPax({ ...pax, caseNumber: e.target.value })} /></label>}
          {f.brokenPlate && <label className="field"><span>Immatriculation du véhicule en panne</span><input value={pax.brokenPlate} maxLength={12} placeholder="AB-123-CD" autoCapitalize="characters" onChange={(e) => setPax({ ...pax, brokenPlate: e.target.value.toUpperCase() })} /></label>}
          {f.department && <label className="field"><span>Service / étage à l'arrivée</span><input value={pax.department} maxLength={80} placeholder="Ex. : accueil principal, 3e étage" onChange={(e) => setPax({ ...pax, department: e.target.value })} /><em className="small">Aucune information médicale : seulement l'endroit où déposer le passager.</em></label>}
          {f.walkingAssist && <label className="check"><input type="checkbox" checked={pax.walkingAssist} onChange={(e) => setPax({ ...pax, walkingAssist: e.target.checked })} /><span>Le passager a besoin d'aide pour marcher jusqu'à la porte</span></label>}
          <label className="field"><span>Langue des messages</span>
            <select value={pax.language} onChange={(e) => setPax({ ...pax, language: e.target.value })}><option value="fr">Français</option><option value="en">Anglais</option></select></label>
          <fieldset className="field"><legend>Besoins particuliers</legend>
            {session.needs.map((n) => <label key={n} className="check" style={{ margin: "6px 0" }}><input type="checkbox" checked={needs.includes(n)} onChange={(e) => setNeeds(e.target.checked ? [...needs, n] : needs.filter((x) => x !== n))} /><span>{NEED.fr[n] ?? n}</span></label>)}
          </fieldset>
          <fieldset className="field"><legend>Qui paie ?</legend>
            <label className="check"><input type="radio" name="pay" checked={!payOnBoard} onChange={() => setPayOnBoard(false)} /><span>{text.payer}</span></label>
            <label className="check"><input type="radio" name="pay" checked={payOnBoard} onChange={() => setPayOnBoard(true)} /><span>Le {text.person}, par carte bancaire à bord</span></label>
          </fieldset>
          <label className="field"><span>Précisions pour le chauffeur (facultatif)</span><textarea rows={2} maxLength={300} value={pax.notes} onChange={(e) => setPax({ ...pax, notes: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={pax.consent} onChange={(e) => setPax({ ...pax, consent: e.target.checked })} /><span>Le {text.person} est d'accord pour que ses coordonnées soient transmises à CliCab et au chauffeur, uniquement pour ce trajet. <a href={PRIVACY_URL} target="_blank" rel="noreferrer">Politique de confidentialité</a></span></label>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="primary" disabled={busy || !pax.consent || !pax.firstName.trim() || !pax.lastName.trim() || pax.phone.trim().length < 6}>{busy ? "Envoi…" : quote.return ? "Commander l'aller et le retour" : "Commander la course"}</button>
        </form>
      )}
    </section>
  );
}

function Rides({ call, onRevoked, billed }: { call: Call; onRevoked: () => void; billed: string }) {
  const [month, setMonth] = useState(parisMonth());
  const [list, setList] = useState<List | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try { setList(await call<List>(`/v1/hotel/bookings?month=${month}`)); setErr(""); }
    catch (e: any) { if (e.status === 401) onRevoked(); else setErr(`${e.message} (statuts peut-être anciens)`); }
  }, [call, month, onRevoked]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    window.addEventListener("hotel-booked", load);
    return () => { clearInterval(t); window.removeEventListener("hotel-booked", load); };
  }, [load]);

  async function cancel(r: HotelRow) {
    if (!confirm(`Annuler la course ${r.reference} de ${r.passenger} ?\n\nFrais d'annulation (conditions provisoires) : gratuit à plus de 24 h, 50 % entre 24 h et 2 h, 100 % à moins de 2 h.`)) return;
    setBusy(r.id);
    try { const c = await call<{ cancellationFee: number }>(`/v1/bookings/${r.id}`, { method: "DELETE" }); alert(c.cancellationFee ? `Course annulée. Frais : ${eur(c.cancellationFee)}.` : "Course annulée, sans frais."); load(); }
    catch (e: any) { alert(e.message); } finally { setBusy(""); }
  }

  function download() {
    if (!list) return;
    const url = URL.createObjectURL(new Blob([statementCsv(list.rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `releve-clicab-${list.month}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
  const rows = list?.rows.filter((r) => showDone || !DONE.has(r.status)) ?? [];
  return (
    <section>
      <div className="card">
        <div className="hotel-month">
          <button type="button" className="link" aria-label="Mois précédent" onClick={() => setMonth(shiftMonth(month, -1))}>◀</button>
          <h2 style={{ margin: 0 }}>Courses · {label}</h2>
          <button type="button" className="link" aria-label="Mois suivant" onClick={() => setMonth(shiftMonth(month, 1))}>▶</button>
        </div>
        {list && (
          <div className="hotel-totals">
            <div><span>{billed}</span><b>{eur(list.totals.billed)}</b></div>
            <div><span>Encaissé à bord par les chauffeurs</span><b>{eur(list.totals.onBoard)}</b>{list.totals.unpaidOnBoard > 0 && <span className="err">dont impayé signalé : {eur(list.totals.unpaidOnBoard)}</span>}</div>
            <div><span>Frais d'annulation</span><b>{eur(list.totals.cancellationFees)}</b></div>
          </div>
        )}
        <p className="small">Courses terminées seulement. Relevé indicatif : ce n'est pas une facture.</p>
        <div className="hotel-tools">
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /><span>Afficher aussi les courses terminées et annulées</span></label>
          <button type="button" className="link" onClick={download} disabled={!list?.rows.length}>Télécharger le relevé (Excel)</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      {list && !rows.length && <div className="card"><p className="muted">Aucune course {showDone ? "ce mois-ci" : "à venir ou en cours ce mois-ci"}.</p></div>}
      {rows.map((r) => (
        <article key={r.id} className="card hotel-ride">
          <div className="hotel-ride-top"><b>{parisDateTime(r.pickupAt)}</b><span className={`hotel-chip ${DONE.has(r.status) ? "" : "live"}`}>{STATUS[r.status] ?? r.status}</span></div>
          <p><b>{r.passenger}</b>{r.room && r.room !== "HOTEL" ? ` · ${r.room}` : ""} · {r.reference}</p>
          <p className="muted">{r.pickup} → {r.dropoff}{r.flightNumber ? ` · vol ${r.flightNumber}` : ""}</p>
          <p className={`small ${r.onBoardPayment?.status === "ISSUE" && !r.onBoardPayment.resolved ? "err" : ""}`}>{eur(r.total)} · {paymentLabel(r).toLowerCase()}{r.cancellationFee ? ` · frais d'annulation ${eur(r.cancellationFee)}` : ""}</p>
          {r.driver && <p>Chauffeur : <b>{r.driver.firstName}</b>{r.driver.vehicle ? ` · ${r.driver.vehicle}` : ""}{r.driver.plate ? <> · <span className="plate">{r.driver.plate}</span></> : null}</p>}
          <div className="hotel-tools">
            {r.trackingUrl && !DONE.has(r.status) && <a className="link" href={r.trackingUrl} target="_blank" rel="noreferrer">Voir le suivi</a>}
            {CANCELLABLE.has(r.status) && <button type="button" className="link danger" disabled={!!busy} onClick={() => cancel(r)}>{busy === r.id ? "Annulation…" : "Annuler"}</button>}
          </div>
        </article>
      ))}
    </section>
  );
}
