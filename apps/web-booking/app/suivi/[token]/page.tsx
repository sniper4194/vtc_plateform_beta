"use client";
import { useEffect, useState } from "react";
import { API_URL, headline, isCancelled, STEPS, stepIndex, text, type Lang, type Tracking } from "../../../lib/tracking";

const when = (iso: string, lang: Lang) => new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Suivi({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Tracking | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "gone" | "offline">("loading");
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch(`${API_URL}/track/${encodeURIComponent(params.token)}`, { cache: "no-store" });
        if (stop) return;
        if (r.status === 404) { setState("gone"); return; }
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json()); setState("ok"); setAt(new Date());
      } catch { if (!stop) setState((s) => (s === "ok" ? s : "offline")); }
    }
    load();
    const t = setInterval(load, 10000);
    return () => { stop = true; clearInterval(t); };
  }, [params.token]);

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
