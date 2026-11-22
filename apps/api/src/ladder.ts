/**
 * Échelle de prix chauffeur : le prix proposé part bas et MONTE à l'approche de la mission, jusqu'au plafond
 * (prix client − commission de base). Le premier chauffeur qui accepte prend le prix du moment ; l'écart avec
 * le plafond reste à la plateforme. Fonctions pures (aucun accès base de données ni horloge cachée).
 */

export interface LadderConfig {
  enabled: boolean;
  /** Part du plafond proposée au départ (0,85 = 85 %). */
  startRatio: number;
  /** La hausse commence N minutes avant la prise en charge… */
  rampFromMin: number;
  /** …et atteint le plafond N minutes avant la prise en charge. */
  rampToMin: number;
  /** Pas de prix (centimes) : le prix proposé est arrondi vers le bas à ce pas. */
  stepCents: number;
}

export const DEFAULT_LADDER: LadderConfig = { enabled: true, startRatio: 0.85, rampFromMin: 24 * 60, rampToMin: 60, stepCents: 10 };

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** Lue à chaque appel (pas à l'import) : réglable par variables d'environnement. PRICE_LADDER=0 la désactive. */
export function ladderFromEnv(env: NodeJS.ProcessEnv = process.env): LadderConfig {
  const start = num(env.LADDER_START_RATIO, DEFAULT_LADDER.startRatio);
  const from = num(env.LADDER_FROM_MIN, DEFAULT_LADDER.rampFromMin);
  const to = num(env.LADDER_TO_MIN, DEFAULT_LADDER.rampToMin);
  return {
    enabled: env.PRICE_LADDER !== "0",
    startRatio: Math.min(1, Math.max(0.3, start)), // jamais sous 30 % du plafond
    rampFromMin: Math.max(from, to + 1),
    rampToMin: Math.max(0, to),
    stepCents: Math.max(1, Math.round(num(env.LADDER_STEP_CENTS, DEFAULT_LADDER.stepCents))),
  };
}

/**
 * Revenu minimal par course pour un chauffeur relié à une plateforme : 9 € net de commission (Service-Public, vérifié le 12/08/2026 ; accords de 2023).
 * Montant révisé chaque année : réglable (MIN_DRIVER_PAY_CENTS). Les garanties horaire (30 €/h) et kilométrique (1 €/km) citées par la même page ne sont pas appliquées :
 * leur mode de calcul exact n'est pas connu.
 */
export const minDriverPayCents = (env: NodeJS.ProcessEnv = process.env) => Math.max(0, Math.round(num(env.MIN_DRIVER_PAY_CENTS, 900)));

/** Prix proposé au chauffeur à l'instant `now` pour une prise en charge à `pickupAt`. Toujours ≤ plafond, jamais décroissant dans le temps. */
export function driverOfferCents(capCents: number, pickupAt: Date, now: Date, cfg: LadderConfig = ladderFromEnv()): number {
  if (!cfg.enabled || capCents <= 0) return Math.max(0, capCents);
  const floor = Math.min(capCents, minDriverPayCents()); // jamais sous le revenu minimal par course
  const minutesLeft = (pickupAt.getTime() - now.getTime()) / 60_000;
  const progress = Math.min(1, Math.max(0, (cfg.rampFromMin - minutesLeft) / (cfg.rampFromMin - cfg.rampToMin)));
  const ratio = cfg.startRatio + (1 - cfg.startRatio) * progress;
  const raw = Math.floor((capCents * ratio) / cfg.stepCents) * cfg.stepCents;
  // Au plafond (ou si le pas dépasse le plafond) : on propose exactement le plafond.
  return progress >= 1 ? capCents : Math.max(floor, Math.min(capCents, raw));
}

/** Prochaine hausse affichable : l'instant où le prix proposé change, et sa nouvelle valeur (null si déjà au plafond). */
export function nextIncrease(capCents: number, pickupAt: Date, now: Date, cfg: LadderConfig = ladderFromEnv()): { at: Date; cents: number } | null {
  const current = driverOfferCents(capCents, pickupAt, now, cfg);
  if (!cfg.enabled || current >= capCents) return null;
  // Recherche à la minute : la hausse est monotone, on avance jusqu'au premier changement (au plus rampFromMin minutes).
  for (let m = 1; m <= cfg.rampFromMin; m++) {
    const at = new Date(now.getTime() + m * 60_000);
    const price = driverOfferCents(capCents, pickupAt, at, cfg);
    if (price > current) return { at, cents: price };
  }
  return null;
}
