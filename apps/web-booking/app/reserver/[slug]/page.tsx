"use client";
import { use, useEffect, useState } from "react";
import { CATEGORY, NEED, parisToIso, T, type Lang } from "../../../lib/hosted";
import { API_URL } from "../../../lib/tracking";

type Info = { name: string; place: { label: string; address: string }; needsCode: boolean; hubs: { id: string; label: string; airport: boolean }[]; categories: string[]; needs: string[] };
type Quote = { quoteId: string; total: string; currency: string; distanceKm: number; durationMin: number; pickup: string; dropoff: string; expiresAt: string };

const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL ?? "https://clicab.fr/confidentialite.html";

async function post<R>(path: string, body: unknown): Promise<R> {
  const r = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const first = j?.errors ? Object.entries(j.errors as Record<string, string[]>).map(([k, v]) => `${k} : ${v[0]}`)[0] : null;
    throw new Error(first ?? j?.message ?? `Erreur ${r.status}`);
  }
  return j as R;
}

/** Page de réservation hébergée par CliCab au nom d'un hôtel ou d'une agence (sans compte, sans clé d'API). */
export default function Reserver({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [lang, setLang] = useState<Lang>("fr");
  const t = T[lang];
  const [info, setInfo] = useState<Info | null>(null);
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [trip, setTrip] = useState({ direction: "FROM_HUB", hub: "CDG-T2", date: "", time: "", category: "BERLINE", passengers: "1", luggage: "1", flightNumber: "", code: "" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pax, setPax] = useState({ firstName: "", lastName: "", phone: "", email: "", notes: "", consent: false });
  const [needs, setNeeds] = useState<string[]>([]);
  const [done, setDone] = useState<{ reference: string; trackingUrl: string | null; total: string } | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("fr")) setLang("en");
    fetch(`${API_URL}/public/book/${encodeURIComponent(slug)}`).then(async (r) => { if (r.status === 404) setGone(true); else if (r.ok) setInfo(await r.json()); else setErr(`Erreur ${r.status}`); }).catch(() => setErr(T.fr.offline));
  }, [slug]);

  const hub = info?.hubs.find((h) => h.id === trip.hub);
  const setT = (k: keyof typeof trip, v: string) => { setTrip({ ...trip, [k]: v }); setQuote(null); };
  const fail = (e: any) => setErr(e?.message === "Failed to fetch" ? t.offline : e?.message ?? String(e));

  async function getQuote(ev: React.FormEvent) {
    ev.preventDefault(); setErr("");
    const pickupAt = parisToIso(trip.date, trip.time);
    if (!pickupAt) { setErr(t.invalidWhen); return; }
    setBusy(true);
    try {
      setQuote(await post<Quote>(`/public/book/${slug}/quote`, {
        hub: trip.hub, direction: trip.direction, pickupAt, category: trip.category, passengers: Number(trip.passengers), luggage: Number(trip.luggage),
        ...(trip.flightNumber.trim() && hub?.airport && trip.direction === "FROM_HUB" ? { flightNumber: trip.flightNumber.replace(/\s/g, "") } : {}),
        ...(trip.code ? { code: trip.code } : {}),
      }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function book(ev: React.FormEvent) {
    ev.preventDefault(); setErr("");
    if (!quote) return;
    setBusy(true);
    try {
      setDone(await post(`/public/book/${slug}/booking`, {
        quoteId: quote.quoteId, consent: pax.consent, needs, ...(pax.notes.trim() ? { notes: pax.notes.trim() } : {}), ...(trip.code ? { code: trip.code } : {}),
        passenger: { firstName: pax.firstName, lastName: pax.lastName, phone: pax.phone, ...(pax.email.trim() ? { email: pax.email.trim() } : {}), language: lang },
      }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const head = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div className="brand">CliCab</div>
      <button type="button" className="link" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>{lang === "fr" ? "English" : "Français"}</button>
    </div>
  );
  if (gone) return <main className="wrap">{head}<div className="card"><p className="err">{t.notFound}</p></div></main>;
  if (!info) return <main className="wrap">{head}<div className="card"><p className="muted">{err || "…"}</p></div></main>;
  if (done) return (
    <main className="wrap">{head}
      <div className="card">
        <h1>{t.booked}</h1>
        <p className="muted">{t.ref} <b>{done.reference}</b> · {t.price} {done.total} €</p>
        {done.trackingUrl && <><a className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href={done.trackingUrl}>{t.track}</a><p className="small">{t.trackNote}</p></>}
      </div>
    </main>
  );

  return (
    <main className="wrap">
      {head}
      <form className="card" onSubmit={getQuote} noValidate>
        <h1>{t.title}</h1>
        <p className="muted">{info.place.label} · {info.place.address}</p>
        <fieldset className="field">
          <legend>{t.trip}</legend>
          <label className="check"><input type="radio" name="dir" checked={trip.direction === "FROM_HUB"} onChange={() => setT("direction", "FROM_HUB")} /><span>{t.fromHub} {info.place.label}</span></label>
          <label className="check"><input type="radio" name="dir" checked={trip.direction === "TO_HUB"} onChange={() => setT("direction", "TO_HUB")} /><span>{t.toHub} {info.place.label} {t.toHubTo}</span></label>
        </fieldset>
        <label className="field"><span>{t.hub}</span>
          <select value={trip.hub} onChange={(e) => setT("hub", e.target.value)}>{info.hubs.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}</select></label>
        <div className="two">
          <label className="field" style={{ margin: 0 }}><span>{t.date}</span><input type="date" value={trip.date} onChange={(e) => setT("date", e.target.value)} /></label>
          <label className="field" style={{ margin: 0 }}><span>{t.time}</span><input type="time" value={trip.time} onChange={(e) => setT("time", e.target.value)} /></label>
        </div>
        <label className="field"><span>{t.category}</span>
          <select value={trip.category} onChange={(e) => setT("category", e.target.value)}>{info.categories.map((c) => <option key={c} value={c}>{CATEGORY[lang][c] ?? c}</option>)}</select></label>
        <div className="two">
          <label className="field" style={{ margin: 0 }}><span>{t.passengers}</span><input inputMode="numeric" value={trip.passengers} onChange={(e) => setT("passengers", e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field" style={{ margin: 0 }}><span>{t.luggage}</span><input inputMode="numeric" value={trip.luggage} onChange={(e) => setT("luggage", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        {hub?.airport && trip.direction === "FROM_HUB" && <label className="field"><span>{t.flight}</span><input value={trip.flightNumber} placeholder="AF1234" autoCapitalize="characters" onChange={(e) => setT("flightNumber", e.target.value.toUpperCase())} /></label>}
        {info.needsCode && <label className="field"><span>{t.code}</span><input value={trip.code} autoComplete="off" onChange={(e) => setT("code", e.target.value)} /><em className="small">{t.codeHint}</em></label>}
        {!quote && <button className="primary" disabled={busy}>{t.quote}</button>}
        {err && !quote && <p className="err">{err}</p>}
      </form>

      {quote && (
        <form className="card" onSubmit={book} noValidate>
          <h2>{t.price}</h2>
          <h1 style={{ margin: 0 }}>{quote.total} €</h1>
          <p className="small">{quote.pickup} → {quote.dropoff} · {quote.distanceKm} km · ~{quote.durationMin} min. {t.priceNote}</p>
          <button type="button" className="link" onClick={() => setQuote(null)}>{t.change}</button>
          <label className="field"><span>{t.firstName}</span><input autoComplete="given-name" value={pax.firstName} onChange={(e) => setPax({ ...pax, firstName: e.target.value })} /></label>
          <label className="field"><span>{t.lastName}</span><input autoComplete="family-name" value={pax.lastName} onChange={(e) => setPax({ ...pax, lastName: e.target.value })} /></label>
          <label className="field"><span>{t.phone}</span><input type="tel" autoComplete="tel" placeholder="+33 6 12 34 56 78" value={pax.phone} onChange={(e) => setPax({ ...pax, phone: e.target.value })} /></label>
          <label className="field"><span>{t.email}</span><input type="email" autoComplete="email" value={pax.email} onChange={(e) => setPax({ ...pax, email: e.target.value })} /></label>
          <fieldset className="field"><legend>{t.needs}</legend>
            {info.needs.map((n) => <label key={n} className="check" style={{ margin: "6px 0" }}><input type="checkbox" checked={needs.includes(n)} onChange={(e) => setNeeds(e.target.checked ? [...needs, n] : needs.filter((x) => x !== n))} /><span>{NEED[lang][n] ?? n}</span></label>)}
          </fieldset>
          <label className="field"><span>{t.notes}</span><textarea rows={2} maxLength={300} value={pax.notes} onChange={(e) => setPax({ ...pax, notes: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={pax.consent} onChange={(e) => setPax({ ...pax, consent: e.target.checked })} /><span>{t.consent} <a href={PRIVACY_URL} target="_blank" rel="noreferrer">{t.privacy}</a></span></label>
          {err && <p className="err">{err}</p>}
          <button className="primary" disabled={busy || !pax.consent || !pax.firstName.trim() || !pax.lastName.trim() || pax.phone.trim().length < 6}>{t.book}</button>
        </form>
      )}
    </main>
  );
}
