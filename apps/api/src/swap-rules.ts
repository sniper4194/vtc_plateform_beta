/**
 * Bourse d'échange entre chauffeurs. Pourquoi : un empêchement connu à l'avance ne doit pas coûter une pénalité ni faire
 * repartir la mission au dispatch ; un collègue éligible la reprend directement, aux mêmes conditions de prix.
 * Délai minimal avant la prise en charge (heures) : valeur de départ, à confirmer.
 */
export const swapMinHours = (env: NodeJS.ProcessEnv = process.env) => {
  const v = Number(env.SWAP_MIN_HOURS);
  return Number.isFinite(v) && v > 0 ? v : 48;
};

/** Vrai si la mission est encore assez loin pour être mise à l'échange ou reprise. */
export function swapOpen(pickup: Date, now: Date, minHours = swapMinHours()) {
  return pickup.getTime() - now.getTime() >= minHours * 3600_000;
}

