import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Parrainage récompensé. Pourquoi : le parrain est déjà responsable de ses filleuls ; une petite prime sur leurs premières
 * courses l'aligne sur la qualité de ceux qu'il fait entrer.
 * Garde-fous voulus : un seul niveau, nombre de courses plafonné, prise sur la commission de la plateforme.
 * DÉSACTIVÉ PAR DÉFAUT : le principe doit être validé par un juriste (risque de système pyramidal ou de qualification
 * commerciale) avant toute activation. Montant et nombre de courses : valeurs de départ, à confirmer.
 */
export function referralRewardConfig(env: NodeJS.ProcessEnv = process.env) {
  const num = (k: string, d: number) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  return {
    enabled: env.REFERRAL_REWARD_ENABLED === "1",
    amountCents: Math.round(num("REFERRAL_REWARD_CENTS", 100)),
    rides: Math.round(num("REFERRAL_REWARD_RIDES", 10)),
  };
}

/** Montant dû pour la n-ième course terminée du filleul (n à partir de 1), plafonné par la commission restante. */
export function rewardCents(nth: number, commissionLeftCents: number, cfg = referralRewardConfig()) {
  if (!cfg.enabled || nth < 1 || nth > cfg.rides) return 0;
  return Math.max(0, Math.min(cfg.amountCents, commissionLeftCents));
}

/** À appeler dans la transaction qui termine la course. Ne fait rien si désactivé, sans parrain, ou parrain non actif. */
export async function grantReferralReward(tx: Tx, rideId: string, driverId: string, cfg = referralRewardConfig()) {
  if (!cfg.enabled || cfg.amountCents <= 0 || cfg.rides <= 0) return null;
  const d = await tx.driver.findUnique({ where: { id: driverId }, select: { sponsorId: true, sponsor: { select: { status: true } } } });
  if (!d?.sponsorId || d.sponsor?.status !== "ACTIVE") return null;
  const nth = await tx.ride.count({ where: { driverId, status: "COMPLETED" } }); // la course en cours est déjà COMPLETED
  const ride = await tx.ride.findUniqueOrThrow({ where: { id: rideId }, select: { commissionCents: true } });
  const amount = rewardCents(nth, ride.commissionCents, cfg);
  if (amount <= 0) return null;
  await tx.ride.update({ where: { id: rideId }, data: { commissionCents: { decrement: amount } } });
  return tx.referralReward.create({ data: { sponsorId: d.sponsorId, filleulId: driverId, rideId, amountCents: amount } });
}
