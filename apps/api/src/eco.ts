/**
 * Prime écologique : le chauffeur qui prend une mission avec un véhicule électrique touche une majoration de sa rémunération
 * (5 % par défaut), prélevée sur la commission de la plateforme (jamais sur le prix client). Elle est plafonnée par ce qu'il reste
 * de commission : la plateforme ne vend jamais à perte. Réglable par ECO_BONUS_PERCENT (0 la désactive).
 */
export const ecoBonusPercent = (env: NodeJS.ProcessEnv = process.env) => {
  const v = env.ECO_BONUS_PERCENT;
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : 5;
};

/**
 * `netCents` : rémunération du chauffeur avant prime (le prix proposé) ; `commissionLeftCents` : ce qui reste à la plateforme
 * une fois ce prix déterminé (prix client − prix proposé).
 */
export function ecoBonusCents(fuel: string | null | undefined, netCents: number, commissionLeftCents: number, env: NodeJS.ProcessEnv = process.env): number {
  if (fuel !== "ELECTRIC") return 0;
  const bonus = Math.round((Math.max(0, netCents) * ecoBonusPercent(env)) / 100);
  return Math.max(0, Math.min(bonus, commissionLeftCents));
}
