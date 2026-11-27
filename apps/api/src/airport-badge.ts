import { HttpException } from "@nestjs/common";
import { zonesOf } from "./zones";

/**
 * Badge d'accès aéroport, justifié par la facture de parking Aéroports de Paris (demande de l'utilisateur ; base légale non vérifiée).
 * Sans badge validé, le chauffeur reste en ligne et garde ses autres courses : seules les prises en charge dans une zone listée
 * lui sont fermées. AIRPORT_BADGE_ENABLED=0 désactive la règle ; AIRPORT_BADGE_ZONES : zones de départ concernées en plus du mot « aéroport »
 * dans l'adresse (défaut CDG, Orly et Beauvais).
 */
export function airportBadgeZones(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.AIRPORT_BADGE_ZONES ?? "CDG,ORLY,BEAUVAIS";
  return raw.split(",").map((z) => z.trim().toUpperCase()).filter(Boolean);
}

/** « aéroport » (avec ou sans accent, toute casse) ou « airport » dans l'adresse de départ. */
const AIRPORT_WORD = /a[ée]roport|airport/i;

/**
 * Vrai si la prise en charge exige le badge : adresse de départ contenant le mot « aéroport » (tout aéroport, choix de l'utilisateur),
 * ou point de départ dans une zone listée (filet si l'adresse est mal saisie). Seul le DÉPART compte : aller vers l'aéroport reste libre.
 */
export function needsAirportBadge(ride: { pickupLat: number; pickupLng: number; pickupAddress?: string | null }, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AIRPORT_BADGE_ENABLED === "0") return false;
  if (ride.pickupAddress && AIRPORT_WORD.test(ride.pickupAddress)) return true;
  const zones = airportBadgeZones(env);
  return zones.length > 0 && zonesOf({ lat: ride.pickupLat, lng: ride.pickupLng }).some((z) => zones.includes(z));
}

/** Chauffeurs (parmi ceux donnés) qui ont un badge validé et non échu. */
export async function driversWithBadge(db: any, driverIds: string[], now = new Date()): Promise<Set<string>> {
  if (!driverIds.length) return new Set();
  const docs: { driverId: string }[] = await db.document.findMany({
    where: { driverId: { in: driverIds }, type: "AIRPORT_BADGE", status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { driverId: true },
  });
  return new Set(docs.map((d) => d.driverId));
}

export const AIRPORT_BADGE_MESSAGE = "Badge d'accès aéroport requis : envoyez votre facture de parking ADP pour prendre les courses au départ de l'aéroport";

/** Refuse l'attribution d'une prise en charge à l'aéroport à un chauffeur sans badge validé. */
export async function assertAirportBadge(db: any, driverId: string, ride: { pickupLat: number; pickupLng: number; pickupAddress?: string | null }) {
  if (!needsAirportBadge(ride)) return;
  if (!(await driversWithBadge(db, [driverId])).has(driverId)) throw new HttpException(AIRPORT_BADGE_MESSAGE, 409);
}
