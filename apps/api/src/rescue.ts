import { fmtDateTime } from "./notifications";
import { money, RideForMessage, rideDetailLines } from "./messages";

/** Critères d'accès au statut « sauveteur » : réglables par l'environnement, évalués à chaque appel (jamais figés). */
export const RESCUE = {
  get minRating() { return Number(process.env.RESCUE_MIN_RATING ?? 4.8); },
  get minReliability() { return Number(process.env.RESCUE_MIN_RELIABILITY ?? 0.9); },
  get minRides() { return Number(process.env.RESCUE_MIN_RIDES ?? 30); },
  /** Prime versée au sauveteur, prélevée sur la commission de la plateforme (jamais sur le prix client). */
  get bonusCents() { return Number(process.env.RESCUE_BONUS_CENTS ?? 1000); },
  ttlMaxMin: 30,
  /** Au-delà, la demande est refusée : le chauffeur doit passer par la restitution ordinaire. */
  maxOpenPerMonth: 3,
};

export interface EliteInput { status: string; rating: number; reliability: number; completedRides: number; rescueOptIn: boolean; rescueRevokedAt: Date | null }
export interface EliteCheck { eligible: boolean; listed: boolean; criteria: { key: string; label: string; ok: boolean; value: string; required: string }[] }

/** `eligible` : remplit les critères. `listed` : eligible, a accepté d'apparaître dans la liste et n'est pas révoqué. */
export function eliteCheck(d: EliteInput): EliteCheck {
  const criteria = [
    { key: "active", label: "Compte actif", ok: d.status === "ACTIVE", value: d.status === "ACTIVE" ? "oui" : "non", required: "oui" },
    { key: "rating", label: "Note moyenne", ok: d.rating >= RESCUE.minRating, value: d.rating.toFixed(2), required: `≥ ${RESCUE.minRating}` },
    { key: "reliability", label: "Fiabilité", ok: d.reliability >= RESCUE.minReliability, value: `${Math.round(d.reliability * 100)} %`, required: `≥ ${Math.round(RESCUE.minReliability * 100)} %` },
    { key: "rides", label: "Missions terminées", ok: d.completedRides >= RESCUE.minRides, value: String(d.completedRides), required: `≥ ${RESCUE.minRides}` },
  ];
  const eligible = criteria.every((c) => c.ok) && !d.rescueRevokedAt;
  return { eligible, listed: eligible && d.rescueOptIn, criteria };
}

/** Prime effective : plafonnée par la commission restante, pour que la plateforme ne vende jamais à perte. */
export const rescueBonusCents = (commissionCents: number) => Math.max(0, Math.min(RESCUE.bonusCents, commissionCents));

/** Un chauffeur peut passer le relais tant que le client n'est pas à bord ni sur place. */
export const RESCUABLE = ["ASSIGNED", "EN_ROUTE"] as const;

export function rescueRequestMessage(ride: RideForMessage, flightNumber: string | null, requesterName: string, reason: string, bonusCents: number, direct: boolean) {
  const lines = [
    `${requesterName} a besoin d'un sauveteur pour la mission R-${ride.ref}${direct ? " et vous a choisi" : ""}.`, `Motif : ${reason}`, "",
    ...rideDetailLines(ride, flightNumber), "",
    `Votre rémunération : ${money(ride.driverNetCents + bonusCents)}${bonusCents > 0 ? ` (dont prime sauveteur ${money(bonusCents)})` : ""}.`,
    "Le passager vous est communiqué dès que vous acceptez. Premier sauveteur qui accepte : la mission lui est attribuée.",
  ];
  return { title: `Appel à l'aide · R-${ride.ref}`, body: lines.join("\n") };
}

export function rescueAcceptedToRequester(ref: number, pickupAt: Date, rescuerName: string) {
  return {
    title: `Mission R-${ref} reprise`,
    body: `${rescuerName} reprend la mission R-${ref} (${fmtDateTime(pickupAt)}). Vous n'avez plus rien à faire : la mission a quitté votre planning. Aucune pénalité de fiabilité n'est appliquée.`,
  };
}

export function rescueExpiredToRequester(ref: number) {
  return {
    title: `Aucun sauveteur pour R-${ref}`,
    body: `Personne n'a repris la mission R-${ref} à temps. Elle reste la vôtre. Si vous ne pouvez vraiment pas l'assurer, utilisez « Rendre la mission » : le dispatch la propose à tous les chauffeurs.`,
  };
}
