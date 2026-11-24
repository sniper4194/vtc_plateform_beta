/**
 * Garantie de prise en charge et fiabilité, en fonctions pures.
 *
 * Mission « à risque » : toujours sans chauffeur alors que la prise en charge approche (GUARANTEE_ALERT_MIN minutes, 180 par défaut,
 * valeur à confirmer). Elle déclenche : une relance de toutes les offres, un avertissement au partenaire (webhook « booking.at_risk »)
 * et une alerte sonore dans la tour de contrôle.
 *
 * Fiabilité : chiffres calculés uniquement à partir des courses réelles de la période, avec leurs dénominateurs. Aucun taux n'est affiché
 * quand il n'y a pas de course à compter.
 */
export const guaranteeAlertMin = (env: NodeJS.ProcessEnv = process.env) => {
  const v = Number(env.GUARANTEE_ALERT_MIN);
  return Number.isFinite(v) && env.GUARANTEE_ALERT_MIN !== undefined && env.GUARANTEE_ALERT_MIN !== "" ? Math.max(0, v) : 180;
};

/** Vrai si la mission, encore sans chauffeur, entre dans la fenêtre de garantie (et n'est pas déjà passée). */
export function isAtRisk(effectivePickup: Date, now: Date, alertMin = guaranteeAlertMin()) {
  if (alertMin <= 0) return false;
  const left = (effectivePickup.getTime() - now.getTime()) / 60_000;
  return left <= alertMin && left > -60;
}

export interface RideFacts {
  status: string;
  effectivePickupAt: Date;
  assignedAt: Date | null; // première attribution
  arrivedAt: Date | null; // chauffeur sur place
  exhausted: boolean; // personne n'a pris la mission après tous les tours
  atRisk: boolean; // la garantie a dû être déclenchée
  gaveBack: number; // missions rendues par des chauffeurs
}

const rate = (num: number, den: number) => (den > 0 ? { num, den, pct: Math.round((num / den) * 1000) / 10 } : { num, den, pct: null });
const CANCELLED = ["CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT"];

export function reliability(rides: RideFacts[], alertMin = guaranteeAlertMin()) {
  const counted = rides.filter((r) => !CANCELLED.includes(r.status)); // les annulations du partenaire ou du client ne sont pas imputables
  const assigned = counted.filter((r) => r.assignedAt);
  const early = assigned.filter((r) => r.effectivePickupAt.getTime() - r.assignedAt!.getTime() >= alertMin * 60_000);
  const arrived = counted.filter((r) => r.arrivedAt);
  const onTime = arrived.filter((r) => r.arrivedAt!.getTime() <= r.effectivePickupAt.getTime());
  return {
    missions: counted.length,
    cancelledByCustomer: rides.length - counted.length,
    assignedEarly: rate(early.length, assigned.length), // attribuées avant la fenêtre de garantie
    neverAssigned: counted.filter((r) => !r.assignedAt && (r.exhausted || r.effectivePickupAt.getTime() < Date.now())).length,
    atRisk: counted.filter((r) => r.atRisk).length,
    arrivedOnTime: rate(onTime.length, arrived.length), // chauffeur sur place à l'heure de prise en charge effective
    completed: counted.filter((r) => r.status === "COMPLETED").length,
    noShow: counted.filter((r) => r.status === "NO_SHOW").length,
    givenBack: counted.reduce((s, r) => s + r.gaveBack, 0),
  };
}
