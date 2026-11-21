import { fmtDateTime, fmtTime } from "./notifications";

/** Textes des messages adressés aux chauffeurs (application + e-mail). Fonctions pures, donc testables. */

export interface RideForMessage {
  ref: number; pickupAt: Date; pickupAddress: string; dropoffAddress: string; category: string; flatRateId: string | null;
  priceCents: number; commissionCents: number; driverNetCents: number; flightBufferMin: number;
}

const SERVICE_LABEL: Record<string, string> = { BERLINE: "Berline", BUSINESS: "Berline Business", VAN: "Van", GREEN: "Électrique" };
export const money = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Le chauffeur voit-il le prix client et la commission ? Réglable (DRIVER_SEES_CLIENT_PRICE=0 pour ne montrer que sa rémunération). */
export const driverSeesClientPrice = () => process.env.DRIVER_SEES_CLIENT_PRICE !== "0";

export function rideDetailLines(ride: RideForMessage, flightNumber: string | null): string[] {
  const lines = [`Prise en charge : ${fmtDateTime(ride.pickupAt)}`, `Départ : ${ride.pickupAddress}`, `Arrivée : ${ride.dropoffAddress}`];
  if (flightNumber) {
    const landing = new Date(ride.pickupAt.getTime() - ride.flightBufferMin * 60_000);
    lines.push(`Vol : ${flightNumber} (atterrissage prévu à ${fmtTime(landing)}, prise en charge ${ride.flightBufferMin} min après)`);
  }
  lines.push(`Service : ${SERVICE_LABEL[ride.category] ?? ride.category}${ride.flatRateId ? " · course au forfait" : ""}`);
  return lines;
}

export function priceLines(ride: RideForMessage, showClientPrice = driverSeesClientPrice()): string[] {
  return showClientPrice
    ? [`Prix client (TTC) : ${money(ride.priceCents)}`, `Commission de la plateforme : ${money(ride.commissionCents)}`, `Votre rémunération (net) : ${money(ride.driverNetCents)}`]
    : [`Votre rémunération (net) : ${money(ride.driverNetCents)}`];
}

/** Confirmation envoyée quand le chauffeur accepte une mission, ou quand le dispatch la lui attribue. */
export function acceptanceMessage(ride: RideForMessage, flightNumber: string | null, byDispatch = false) {
  const intro = byDispatch ? `Le dispatch vous a attribué la mission R-${ride.ref} :` : `Vous avez accepté la mission R-${ride.ref} :`;
  const lines = [
    intro, "", ...rideDetailLines(ride, flightNumber), "", ...priceLines(ride), "",
    "Retrouvez tous les détails opérationnels (passager, pancarte, consignes, suivi du vol) dans l'application chauffeur et dans l'espace société.",
  ];
  return { title: byDispatch ? `Mission R-${ride.ref} attribuée` : `Mission R-${ride.ref} confirmée`, body: lines.join("\n") };
}

/** Message adressé au chauffeur quand le partenaire annule une mission qui lui était attribuée. */
export function cancellationMessage(ride: RideForMessage, flightNumber: string | null, compensationCents: number) {
  const lines = [
    `Votre mission R-${ride.ref} a été annulée par le partenaire.`, "", ...rideDetailLines(ride, flightNumber), "", ...priceLines(ride), "",
    "Vous n'êtes plus tenu de réaliser cette mission.",
    compensationCents > 0 ? `Indemnité d'annulation : ${money(compensationCents)}, versée avec votre prochain relevé.` : "Aucune indemnité d'annulation n'est due.",
  ];
  return { title: `Mission R-${ride.ref} annulée`, body: lines.join("\n") };
}
