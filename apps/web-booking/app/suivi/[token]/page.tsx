"use client";
import { use, useEffect, useRef, useState } from "react";
import { API_URL, headline, isCancelled, STEPS, stepIndex, text, type Lang, type Tracking } from "../../../lib/tracking";

type Texts = ReturnType<typeof text>;

/** Objet oublié : le voyageur décrit l'objet ; le chauffeur est prévenu ; jamais d'échange direct de coordonnées. */
function LostItem({ token, info, t, onSent }: { token: string; info: NonNullable<Tracking["lostItem"]>; t: Texts; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API_URL}/track/${encodeURIComponent(token)}/lost-item`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: desc }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErr(j?.errors?.description?.[0] ?? j?.message ?? String(r.status)); return; }
      setOpen(false); setDesc(""); onSent();
    } catch { setErr(t.offline); } finally { setBusy(false); }
  }
  if (!info.canReport && !info.last) return null;
  return (
    <section className="card">
      <h2>{t.lostTitle}</h2>
      {info.last && <p><b>{t.lostStatus[info.last.status] ?? info.last.status}</b></p>}
      {info.canReport && !open && <button className="primary" onClick={() => setOpen(true)}>{t.lostAsk}</button>}
      {open && (
        <div className="lost">
          <label className="field" htmlFor="lost-desc"><span>{t.lostLabel}</span></label>
          <textarea id="lost-desc" rows={3} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} />
          {err && <p className="err">{err}</p>}
          <button className="primary" disabled={busy || desc.trim().length < 3} onClick={send}>{t.lostSend}</button>
          <button className="link" onClick={() => setOpen(false)}>{t.lostCancel}</button>
        </div>
      )}
      {info.canReport && <p className="small">{t.lostHint(info.days)}</p>}
    </section>
  );
}

const when = (iso: string, lang: Lang) => new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Suivi({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Tracking | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "gone" | "offline">("loading");
  const [at, setAt] = useState<Date | null>(null);
  const reload = useRef<() => void>(() => {});

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch(`${API_URL}/track/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (stop) return;
        if (r.status === 404) { setState("gone"); return; }
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json()); setState("ok"); setAt(new Date());
      } catch { if (!stop) setState((s) => (s === "ok" ? s : "offline")); }
    }
    load();
    reload.current = load;
    const t = setInterval(load, 10000);
    return () => { stop = true; clearInterval(t); };
  }, [token]);

  const lang: Lang = data?.language ?? "fr";
  const t = text(lang);

  if (state === "gone") return <main className="wrap"><div className="brand">CliCab</div><div className="card"><p className="err">{text("fr").notFound} · {text("en").notFound}</p></div></main>;
  if (!data) return <main className="wrap"><div className="brand">CliCab</div><div className="card"><p className="muted">{state === "offline" ? t.offline : t.loading}</p></div></main>;

  const idx = stepIndex(data.status);
  const cancelled = isCancelled(data.status);
  const d = data.driver;
  const f = data.flight;
  return (
    <main className="wrap">
      <div className="brand">CliCab</div>
      <section className="hero" aria-live="polite">
        <div className="muted" style={{ fontSize: 13 }}>{t.ref} {data.reference}</div>
        <h1>{headline(lang, data.status)}</h1>
        {!cancelled && <p className="muted" style={{ margin: 0 }}>{t.sub[data.status === "DISPATCHING" ? "CONFIRMED" : data.status] ?? ""}</p>}
        {!cancelled && idx !== null && (
          <>
            <div className="steps" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length - 1} aria-valuenow={idx}>
              {STEPS.map((s, i) => <i key={s} className={i <= idx ? "on" : ""} />)}
            </div>
            <div className="stepnames"><span>{t.short[STEPS[idx]]}</span><span>{idx + 1} / {STEPS.length}</span></div>
          </>
        )}
      </section>

      {d && (
        <section className="card">
          <h2>{t.driver}</h2>
          <div className="driver">
            {d.photoUrl
              ? <img className="photo" src={`${API_URL}${d.photoUrl}`} alt={`${t.driver} : ${d.firstName}`} />
              : <div className="photo" title={t.noPhoto}>{t.noPhoto}</div>}
            <div>
              <b>{d.firstName}</b>
              <span className="muted">{d.vehicle}</span>
              {d.plate && <div className="plate" aria-label={t.plate}>{d.plate}</div>}
            </div>
          </div>
          <p className="small">{t.privacy}</p>
        </section>
      )}

      {data.meetingPoint && (
        <section className="card meet">
          <h2>{t.meetTitle}</h2>
          <img src={`${API_URL}${data.meetingPoint.photoUrl}`} alt={`${t.meetAlt} : ${data.meetingPoint.label}`} />
          <b>{data.meetingPoint.label}</b>
          {data.meetingPoint.note && <p className="small">{data.meetingPoint.note}</p>}
        </section>
      )}

      {data.lostItem && <LostItem token={token} info={data.lostItem} t={t} onSent={() => reload.current()} />}

      {f && (
        <section className={`card flight ${f.status === "CANCELLED" ? "bad" : ""}`}>
          <h2>{t.flight} {f.number}</h2>
          <b>{t.flightStatus[f.status] ?? f.status}</b>
          {f.status === "DELAYED" && f.delayMin > 0 && <p className="small">{t.flightDelay(f.delayMin)}</p>}
          {f.status === "EARLY" && f.earlyMin > 0 && <p className="small">{t.flightEarly(f.earlyMin)}</p>}
        </section>
      )}

      <section className="card">
        <div className="row"><span>{t.at}</span><span>{when(data.pickupAt, lang)}</span></div>
        <div className="row"><span>{t.from}</span><span>{data.pickup}</span></div>
        <div className="row"><span>{t.to}</span><span>{data.dropoff}</span></div>
        <div className="row"><span>{t.sign}</span><span>{data.signText}</span></div>
        {data.notes && <div className="row"><span>{t.notes}</span><span>{data.notes}</span></div>}
      </section>

      <p className="small">{state === "offline" ? t.offline : at ? `${t.updated} ${at.toLocaleTimeString(lang === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
    </main>
  );
}
