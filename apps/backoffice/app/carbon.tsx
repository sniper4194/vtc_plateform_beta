"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const FUEL: Record<string, string> = { THERMAL: "Thermique", HYBRID: "Hybride", ELECTRIC: "Électrique" };
const n = (x: number) => String(x).replace(".", ",");

/** Bilan carbone des courses terminées (30 derniers jours). Désactivé tant que les facteurs ADEME ne sont pas renseignés. */
export function Carbon() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/admin/carbon").then(setData).catch((e) => setErr(e.message)); }, []);
  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>Bilan carbone · 30 derniers jours</h3>
      {err && <div className="err">{err}</div>}
      {data && !data.enabled && (
        <p className="muted" style={{ fontSize: 13 }}>
          Désactivé : les facteurs d'émission ne sont pas renseignés. Relevez-les dans la Base Empreinte de l'ADEME (base-empreinte.ademe.fr, « voiture particulière ») et saisissez-les dans les variables CARBON_FACTOR_THERMAL, CARBON_FACTOR_HYBRID, CARBON_FACTOR_ELECTRIC (kgCO2e par km) et CARBON_SOURCE (version de la base). Aucun chiffre n'est publié sans eux.
        </p>
      )}
      {data?.enabled && (
        <>
          <p style={{ fontSize: 22, fontWeight: 800, margin: "8px 0" }}>{n(data.kgCO2e)} kgCO2e · {data.rides} course{data.rides > 1 ? "s" : ""} · {n(data.km)} km</p>
          <table>
            <thead><tr><th>Motorisation</th><th>Courses</th><th>km</th><th>kgCO2e</th><th>Facteur (kg/km)</th></tr></thead>
            <tbody>
              {Object.entries(data.byFuel as Record<string, any>).map(([k, v]) => (
                <tr key={k}><td>{FUEL[k] ?? k}</td><td>{v.rides}</td><td>{n(v.km)}</td><td>{n(v.kgCO2e)}</td><td>{n(data.factors[k])}</td></tr>
              ))}
            </tbody>
          </table>
          {data.unknownFuelRides > 0 && <p className="err" style={{ fontSize: 13 }}>{data.unknownFuelRides} course(s) non comptée(s) : motorisation du véhicule non renseignée.</p>}
          <p className="muted" style={{ fontSize: 12 }}>Source : {data.source}. {data.basis}.</p>
        </>
      )}
    </div>
  );
}
