/**
 * Règles de planning des chauffeurs, en fonctions pures (testables sans base de données).
 *
 * Garde-fou fatigue : on ne propose plus de mission à un chauffeur qui dépasserait FATIGUE_MAX_MISSION_HOURS heures de mission
 * sur n'importe quelle période de 24 heures. Une mission compte de la prise en charge à l'arrivée, plus la marge entre deux
 * courses (approche, attente) : c'est une estimation, pas un relevé du temps de conduite réel.
 *
 * Missions de retour : une offre qui part près de l'endroit où le chauffeur termine une autre mission, peu après, lui évite
 * de rentrer à vide. Elle lui est proposée en priorité.
 *
 * Les seuils sont des choix de l'équipe (valeurs par défaut à confirmer), pas des normes légales.
 */
import { haversineKm } from "./zones";

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function planningConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    maxMissionHours: Math.max(0, num(env.FATIGUE_MAX_MISSION_HOURS, 10)), // 0 : garde-fou désactivé
    returnRadiusKm: Math.max(0, num(env.RETURN_RADIUS_KM, 3)),
    returnWindowMin: Math.max(0, num(env.RETURN_WINDOW_MIN, 120)),
  };
}

export interface Slot { start: number; end: number } // millisecondes

const DAY = 24 * 3600_000;
const overlap = (a: Slot, w: Slot) => Math.max(0, Math.min(a.end, w.end) - Math.max(a.start, w.start));

/**
 * Minutes de mission dans la pire période de 24 heures qui contient le nouveau créneau.
 * Les débuts de période à examiner suffisent : début du nouveau créneau, fin moins 24 h, et chaque début de créneau entre les deux.
 */
export function worstDayMinutes(existing: Slot[], add: Slot): number {
  const all = [...existing, add];
  const lo = add.end - DAY, hi = add.start;
  const starts = new Set<number>([lo, hi, ...existing.map((s) => s.start).filter((t) => t >= lo && t <= hi)]);
  let worst = 0;
  for (const w0 of starts) {
    const w = { start: w0, end: w0 + DAY };
    const ms = all.reduce((sum, s) => sum + overlap(s, w), 0);
    worst = Math.max(worst, ms);
  }
  return Math.round(worst / 60_000);
}

/** Vrai si accepter ce créneau ferait dépasser le maximum d'heures de mission sur 24 h. */
export function fatigueBlocks(existing: Slot[], add: Slot, maxHours = planningConfig().maxMissionHours): boolean {
  if (maxHours <= 0) return false;
  return worstDayMinutes(existing, add) > maxHours * 60;
}

/** Minutes de mission sur les 24 dernières heures (pour l'affichage au chauffeur). */
export function lastDayMinutes(slots: Slot[], now: number): number {
  const w = { start: now - DAY, end: now };
  return Math.round(slots.reduce((sum, s) => sum + overlap(s, w), 0) / 60_000);
}

export interface PlannedRide { ref: number; dropLat: number; dropLng: number; endAt: number }
export interface ReturnMatch { afterRef: number; gapMin: number; km: number }

/** La mission du chauffeur qui se termine près du départ de l'offre, peu avant : la plus proche dans le temps l'emporte. */
export function returnMatch(planned: PlannedRide[], offer: { pickupLat: number; pickupLng: number; startAt: number }, cfg = planningConfig()): ReturnMatch | null {
  let best: ReturnMatch | null = null;
  for (const p of planned) {
    const gapMin = Math.round((offer.startAt - p.endAt) / 60_000);
    if (gapMin < 0 || gapMin > cfg.returnWindowMin) continue;
    const km = Math.round(haversineKm({ lat: p.dropLat, lng: p.dropLng }, { lat: offer.pickupLat, lng: offer.pickupLng }) * 10) / 10;
    if (km > cfg.returnRadiusKm) continue;
    if (!best || gapMin < best.gapMin) best = { afterRef: p.ref, gapMin, km };
  }
  return best;
}
