/**
 * Prime écologique : le chauffeur qui prend une mission avec un véhicule électrique touche une prime égale à 3 % du prix payé par le client
 * (réglable), prélevée sur la commission de la plateforme (jamais sur le prix client). Elle est plafonnée par ce qu'il reste de commission :
 * la plateforme ne vend jamais à perte. ECO_BONUS_PERCENT la règle (0 la désactive).
 */
export const ecoBonusPercent = (env: NodeJS.ProcessEnv = process.env) => {
  const v = env.ECO_BONUS_PERCENT;
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : 3;
};

/**
 * `clientPriceCents` : prix payé par le client (la base de la prime) ; `commissionLeftCents` : ce qui reste à la plateforme
 * une fois le prix du chauffeur déterminé (prix client − prix proposé).
 */
export function ecoBonusCents(fuel: string | null | undefined, clientPriceCents: number, commissionLeftCents: number, env: NodeJS.ProcessEnv = process.env): number {
  if (fuel !== "ELECTRIC") return 0;
  const bonus = Math.round((Math.max(0, clientPriceCents) * ecoBonusPercent(env)) / 100);
  return Math.max(0, Math.min(bonus, commissionLeftCents));
}
