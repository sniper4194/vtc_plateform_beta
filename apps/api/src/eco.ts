/**
 * Prime écologique : le chauffeur qui prend une mission avec un véhicule électrique touche une prime, prélevée sur la commission
 * de la plateforme (jamais sur le prix client). Elle est plafonnée par ce qu'il reste de commission : la plateforme ne vend jamais à perte.
 * Réglable par ECO_BONUS_CENTS (0 la désactive).
 */
export const ecoBonusConfigCents = (env: NodeJS.ProcessEnv = process.env) => {
  const v = env.ECO_BONUS_CENTS;
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 300;
};

/** `commissionLeftCents` : ce qui reste à la plateforme une fois le prix du chauffeur déterminé (prix client − prix proposé). */
export function ecoBonusCents(fuel: string | null | undefined, commissionLeftCents: number, env: NodeJS.ProcessEnv = process.env): number {
  if (fuel !== "ELECTRIC") return 0;
  return Math.max(0, Math.min(ecoBonusConfigCents(env), commissionLeftCents));
}
