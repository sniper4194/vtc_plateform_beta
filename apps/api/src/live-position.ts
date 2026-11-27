/**
 * Position en direct du chauffeur pendant une course (choix de l'utilisateur : visible par la tour et par le voyageur).
 * Seule la dernière position est conservée (aucun historique de trajet) : données personnelles minimales.
 * Le voyageur ne la voit qu'entre « en route » et la fin de la course, et seulement si elle est récente.
 */
export const LIVE_STATUSES = ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"] as const;
export const liveMaxAgeSec = (env: NodeJS.ProcessEnv = process.env) => {
  const v = Number(env.LIVE_POSITION_MAX_AGE_SEC);
  return Number.isFinite(v) && v > 0 ? v : 180;
};

/** Position partageable, ou null si absente ou trop ancienne (le téléphone ne l'envoie plus). */
export function livePosition(d: { lastLat: number | null; lastLng: number | null; lastSeenAt: Date | null } | null, now = new Date()) {
  if (!d || d.lastLat == null || d.lastLng == null || !d.lastSeenAt) return null;
  const ageSec = Math.round((now.getTime() - d.lastSeenAt.getTime()) / 1000);
  if (ageSec > liveMaxAgeSec()) return null;
  return { lat: d.lastLat, lng: d.lastLng, at: d.lastSeenAt.toISOString(), ageSec };
}
