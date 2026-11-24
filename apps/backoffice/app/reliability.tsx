"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Rate = { num: number; den: number; pct: number | null };
const pct = (r: Rate) => (r.pct == null ? "—" : `${String(r.pct).replace(".", ",")} % (${r.num}/${r.den})`);

/** Fiabilité mesurée sur les courses réelles de la période : ce qu'on promet aux partenaires, chiffré honnêtement. */
export function Reliability() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/admin/reliability?days=${days}`).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)); }, [days]);
  const row = (name: string, r: any, strong = false) => (
    <tr key={name} style={strong ? { fontWeight: 700 } : undefined}>
      <td>{name}</td><td>{r.missions}</td><td>{pct(r.assignedEarly)}</td><td>{pct(r.arrivedOnTime)}</td>
      <td>{r.atRisk}</td><td>{r.neverAssigned}</td><td>{r.givenBack}</td><td>{r.noShow}</td><td>{r.cancelledByCustomer}</td>
    </tr>
  );
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Fiabilité mesurée</h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90].map((d) => <option key={d} value={d}>{d} derniers jours</option>)}
        </select>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Calculée uniquement sur les courses réelles de la période. « Attribuées à temps » : chauffeur trouvé avant la fenêtre de garantie ; « à l'heure » : chauffeur sur place à l'heure de prise en charge effective (retard de vol compris). Les annulations du partenaire ou du client ne comptent pas.
      </p>
      {err && <div className="err">{err}</div>}
      {data && (
        <table>
          <thead><tr><th>Partenaire</th><th>Courses</th><th>Attribuées à temps</th><th>À l'heure</th><th>À risque</th><th>Sans chauffeur</th><th>Rendues</th><th>Client absent</th><th>Annulées (client)</th></tr></thead>
          <tbody>
            {data.partners.map((p: any) => row(p.partner, p))}
            {data.partners.length > 1 && row("Tous", data.total, true)}
            {!data.partners.length && <tr><td colSpan={9} className="muted">Aucune course sur la période.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
