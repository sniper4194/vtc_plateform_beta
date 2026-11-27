import { HttpException } from "@nestjs/common";

/**
 * Paiement à bord par carte (choisi par le partenaire ou le voyageur à la réservation) : seuls les chauffeurs ayant déclaré
 * un terminal de paiement reçoivent et peuvent prendre ces courses. Les autres restent en ligne pour tout le reste.
 * Déclaration simple du chauffeur (choix de l'utilisateur) : aucun justificatif.
 */
export async function driversWithTerminal(db: any, driverIds: string[]): Promise<Set<string>> {
  if (!driverIds.length) return new Set();
  const rows: { id: string }[] = await db.driver.findMany({ where: { id: { in: driverIds }, cardTerminal: true }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export const CARD_TERMINAL_MESSAGE = "Course payée à bord par carte : déclarez votre terminal de paiement pour la prendre";

export async function assertCardTerminal(db: any, driverId: string, ride: { payOnBoard?: boolean | null }) {
  if (!ride.payOnBoard) return;
  if (!(await driversWithTerminal(db, [driverId])).has(driverId)) throw new HttpException(CARD_TERMINAL_MESSAGE, 409);
}
