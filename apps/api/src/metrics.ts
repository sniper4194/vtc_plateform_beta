/** Règles de mesure de la qualité de service (pures, donc testables). */

export const NO_SHOW_WAIT_MIN = 15; // attente minimale avant de déclarer un client absent
export const ON_TIME_TOLERANCE_MIN = 0; // arrivée au plus tard à l'heure effective de prise en charge
export const AVERAGE_LATE_MAX_MIN = 15; // jusqu'à 15 min de retard : « moyenne », au-delà : « mauvaise »

export type Punctuality = "PERFECT" | "AVERAGE" | "POOR";

/** Heure effective de prise en charge = heure demandée + retard de vol. */
export const effectivePickup = (pickupAt: Date, flightDelayMin: number) => new Date(pickupAt.getTime() + flightDelayMin * 60_000);

/** Ponctualité d'une mission : l'arrivée sur place est comparée à l'heure effective (vol retardé inclus). */
export function punctuality(arrivedAt: Date | null, effectivePickupAt: Date): Punctuality {
  if (!arrivedAt) return "POOR";
  const lateMin = (arrivedAt.getTime() - effectivePickupAt.getTime()) / 60_000;
  if (lateMin <= ON_TIME_TOLERANCE_MIN) return "PERFECT";
  return lateMin <= AVERAGE_LATE_MAX_MIN ? "AVERAGE" : "POOR";
}

export const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

/** Variation en % par rapport à la période précédente (null si aucune base de comparaison). */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Clé de jour « YYYY-MM-DD » dans un fuseau donné (Paris par défaut). */
export function dayKeyTz(d: Date, timeZone = "Europe/Paris"): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Liste continue de jours entre deux dates (bornes incluses côté début, exclues côté fin). */
export function daysBetween(from: Date, to: Date, timeZone = "Europe/Paris"): string[] {
  const out: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86400_000) {
    const k = dayKeyTz(new Date(t), timeZone);
    if (out[out.length - 1] !== k) out.push(k);
  }
  const last = dayKeyTz(new Date(to.getTime() - 1), timeZone);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Échappe une cellule CSV et neutralise l'injection de formules (=, +, -, @). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
