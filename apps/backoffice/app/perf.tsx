"use client";
import { useCallback, useEffect, useState } from "react";
import { eur, day } from "../lib/api";

export interface Option { id: string; label: string }

const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

/** Tableau de performance : mêmes chiffres pour la plateforme (toutes sociétés) et pour une société. */
export function PerformanceView({ load, drivers, vehicles, scopeKey = "" }: {
  load: (qs: string) => Promise<any>; drivers: Option[]; vehicles: Option[]; scopeKey?: string;
}) {
  const [days, setDays] = useState(7);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const to = new Date(), from = new Date(to.getTime() - days * 86400_000);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), ...(driverId ? { driverId } : {}), ...(vehicleId ? { vehicleId } : {}) });
    try { setData(await load(qs.toString())); setError(""); } catch (e: any) { setError(e.message); }
  }, [days, driverId, vehicleId, load]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { setDriverId(""); setVehicleId(""); }, [scopeKey]);

  const max = Math.max(1, ...(data?.series ?? []).map((s: any) => s.perfect + s.average + s.poor));
  const r = data?.rides;
  const delta = data?.deltaPct;
  return (
    <>
      <h1 className="title">Performance</h1>
      <div className="card filters">
        <span className="cond muted">Filtrer</span>
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Tous les chauffeurs</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Tous les véhicules</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option>
        </select>
        {(driverId || vehicleId) && <button className="btn" onClick={() => { setDriverId(""); setVehicleId(""); }}>Effacer</button>}
      </div>
      {error && <div className="card redbg">{error}</div>}
      {data && (
        <>
          <div className="kpis">
            <div className="sticker s1" style={{ width: 170, height: 170 }}>
              <span className="cond">Valeur nette</span><b style={{ fontSize: 36 }}>{eur(data.totalValueCents).replace(",00", "")}</b>
              <span className="cond" style={{ color: delta == null ? undefined : delta < 0 ? "var(--red)" : "var(--ok)" }}>{delta == null ? "période précédente : —" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} %`}</span>
            </div>
            <div className="sticker s3"><span className="cond">Missions</span><b>{r.completed}</b><span className="cond muted">terminées</span></div>
            <div className="sticker s2"><span className="cond">À l'heure</span><b style={{ fontSize: 34 }}>{fmtPct(data.rates.onTimeAtPickupPct)}</b><span className="cond">à la prise en charge</span></div>
            <div className="sticker s4"><span className="cond">Acceptation</span><b style={{ fontSize: 34 }}>{fmtPct(data.rates.acceptancePct)}</b><span className="cond">des offres</span></div>
            <div className="sticker s1" style={{ transform: "rotate(4deg)" }}><span className="cond">Note</span><b style={{ fontSize: 34 }}>{data.rating.average ?? "—"}</b><span className="cond">{data.rating.count} avis</span></div>
          </div>
          <div className="card">
            <h3>Qualité des missions</h3>
            <div className="chips">
              <span className="chip blue">Parfaites {r.perfect}</span>
              <span className="chip ok">Moyennes {r.average}</span>
              <span className="chip bad">Mauvaises {r.poor}</span>
              <span className="chip">Client absent {r.noShow}</span>
              <span className="chip">Abandons chauffeur {r.driverCancelled}</span>
              <span className="chip">Taux de réalisation {fmtPct(data.rates.completionPct)}</span>
            </div>
            <p className="muted" style={{ margin: "10px 0 0" }}>Parfaite : arrivée au plus tard à l'heure effective (vol retardé inclus). Moyenne : jusqu'à 15 min de retard. Mauvaise : au-delà.</p>
          </div>
          <div className="card">
            <h3>Missions par jour</h3>
            <div className="bars" role="img" aria-label="Missions par jour">
              {data.series.map((s: any) => {
                const total = s.perfect + s.average + s.poor;
                return (
                  <div className="barcol" key={s.date}>
                    <span className="cond">{total || ""}</span>
                    <div className="bar" style={{ height: `${(total / max) * 100}%` }} title={`${s.perfect} parfaites · ${s.average} moyennes · ${s.poor} mauvaises · ${eur(s.valueCents)}`}>
                      {s.poor > 0 && <i className="seg poor" style={{ flex: s.poor }} />}
                      {s.average > 0 && <i className="seg avg" style={{ flex: s.average }} />}
                      {s.perfect > 0 && <i className="seg perfect" style={{ flex: s.perfect }} />}
                    </div>
                    <span className="cond muted">{day(s.date)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
