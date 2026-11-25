/**
 * Revenus du chauffeur : agrégation pure (aucun accès base), donc testable.
 * « Heures de mission » = de la mise en route à la fin de la course ; le temps en ligne sans mission n'est pas mesuré
 * (aucun journal de connexion) : le net par heure est donc un net par heure DE MISSION, annoncé comme tel.
 */
export type Period = "day" | "week" | "fortnight" | "month";
export const PERIODS: Period[] = ["day", "week", "fortnight", "month"];
const MAX_MISSION_MIN = 12 * 60; // garde-fou : une course jamais « terminée » ne fausse pas la moyenne

const TZ = "Europe/Paris";
/** Décalage (minutes) de Paris par rapport à UTC à un instant donné (heure d'été comprise). */
function offsetMin(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")!.value; // « GMT+1 »
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(p);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
const parisParts = (d: Date) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(d);
  const g = (t: string) => f.find((x) => x.type === t)!.value;
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), wd: g("weekday") };
};
/** Minuit à Paris pour une date civile. */
function parisMidnight(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - offsetMin(new Date(guess.getTime() - offsetMin(guess) * 60_000)) * 60_000);
}
export const dayKey = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Bornes [from, to[ d'une période, à l'heure de Paris. Semaine : du lundi ; quinzaine : 1–15 puis 16–fin de mois. */
export function periodBounds(kind: Period, now = new Date()): { from: Date; to: Date } {
  const { y, m, d, wd } = parisParts(now);
  if (kind === "day") return { from: parisMidnight(y, m, d), to: parisMidnight(y, m, d + 1) };
  if (kind === "week") {
    const back = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
    return { from: parisMidnight(y, m, d - back), to: parisMidnight(y, m, d - back + 7) };
  }
  if (kind === "month") return { from: parisMidnight(y, m, 1), to: parisMidnight(y, m + 1, 1) };
  return d <= 15 ? { from: parisMidnight(y, m, 1), to: parisMidnight(y, m, 16) } : { from: parisMidnight(y, m, 16), to: parisMidnight(y, m + 1, 1) };
}

export interface RideLine {
  rideId: string; ref: number; at: Date; route: string; netCents: number; clientCents: number | null; commissionCents: number | null; missionMin: number;
}
export interface CompLine { rideId: string; ref: number; at: Date; cents: number }
export interface PenaltyLine { id: string; ref: number | null; at: Date; cents: number; kind: string }
/** Prime de parrainage reçue (course d'un filleul). */
export interface RewardLine { id: string; at: Date; cents: number; filleul: string }

export interface Earnings {
  totals: { rides: number; ridesCents: number; compensationCents: number; referralCents: number; penaltyCents: number; netCents: number; missionHours: number; netPerMissionHourCents: number | null; avgPerRideCents: number | null };
  days: { day: string; rides: number; cents: number }[];
  rides: RideLine[]; compensations: CompLine[]; penalties: PenaltyLine[]; referrals: RewardLine[];
}

/** Durée de mission d'une course : de la mise en route à la fin ; à défaut, la durée estimée du trajet. */
export const MIN_MEASURED_MIN = 5; // en dessous, la mesure n'est pas crédible (touches enchaînées) : on retient la durée estimée du trajet
export function missionMinutes(startedAt: Date | null, completedAt: Date | null, estimatedMin: number): number {
  if (startedAt && completedAt && completedAt > startedAt) {
    const measured = (completedAt.getTime() - startedAt.getTime()) / 60_000;
    if (measured >= MIN_MEASURED_MIN) return Math.min(MAX_MISSION_MIN, measured);
  }
  return Math.min(MAX_MISSION_MIN, Math.max(0, estimatedMin));
}

export function aggregate(rides: RideLine[], compensations: CompLine[], penalties: PenaltyLine[], referrals: RewardLine[] = []): Earnings {
  const referralCents = referrals.reduce((s, r) => s + r.cents, 0);
  const ridesCents = rides.reduce((s, r) => s + r.netCents, 0);
  const compensationCents = compensations.reduce((s, c) => s + c.cents, 0);
  const penaltyCents = penalties.reduce((s, p) => s + p.cents, 0);
  const hours = rides.reduce((s, r) => s + r.missionMin, 0) / 60;
  const byDay = new Map<string, { rides: number; cents: number }>();
  const add = (at: Date, cents: number, ride: boolean) => { const k = dayKey(at); const e = byDay.get(k) ?? { rides: 0, cents: 0 }; e.cents += cents; if (ride) e.rides++; byDay.set(k, e); };
  for (const r of rides) add(r.at, r.netCents, true);
  for (const c of compensations) add(c.at, c.cents, false);
  for (const p of penalties) add(p.at, -p.cents, false);
  for (const r of referrals) add(r.at, r.cents, false);
  return {
    totals: {
      rides: rides.length, ridesCents, compensationCents, referralCents, penaltyCents, netCents: ridesCents + compensationCents + referralCents - penaltyCents,
      missionHours: Math.round(hours * 100) / 100,
      netPerMissionHourCents: hours > 0 ? Math.round((ridesCents + compensationCents) / hours) : null, // avant pénalités : mesure le rendement des missions
      avgPerRideCents: rides.length ? Math.round(ridesCents / rides.length) : null,
    },
    days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    rides: [...rides].sort((a, b) => b.at.getTime() - a.at.getTime()), compensations, penalties, referrals,
  };
}

/** Export CSV (séparateur « ; », virgule décimale : s'ouvre directement dans un tableur français). */
export function earningsCsv(e: Earnings): string {
  const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["type;date;reference;detail;montant_eur"];
  for (const r of e.rides) lines.push(["COURSE", dayKey(r.at), `R-${r.ref}`, q(r.route), eur(r.netCents)].join(";"));
  for (const c of e.compensations) lines.push(["INDEMNITE_ANNULATION", dayKey(c.at), `R-${c.ref}`, q("Annulation par le partenaire"), eur(c.cents)].join(";"));
  for (const r of e.referrals ?? []) lines.push(["PRIME_PARRAINAGE", dayKey(r.at), "", q(`Course de votre filleul ${r.filleul}`), eur(r.cents)].join(";"));
  for (const p of e.penalties) lines.push(["PENALITE", dayKey(p.at), p.ref ? `R-${p.ref}` : "", q(p.kind === "RESCUE" ? "Appel de sauveteur" : "Mission rendue"), eur(-p.cents)].join(";"));
  lines.push(["TOTAL", "", "", q("Net de la période"), eur(e.totals.netCents)].join(";"));
  return lines.join("\n") + "\n";
}
