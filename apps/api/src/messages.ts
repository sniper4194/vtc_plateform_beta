import { fmtDateTime, fmtTime } from "./notifications";

/** Textes des messages adressés aux chauffeurs (application + e-mail). Fonctions pures, donc testables. */

export interface RideForMessage {
  ref: number; pickupAt: Date; pickupAddress: string; dropoffAddress: string; category: string; flatRateId: string | null;
  priceCents: number; commissionCents: number; driverNetCents: number; driverCapCents: number; flightBufferMin: number;
  /** Prime écologique incluse dans la rémunération (véhicule électrique). */
  ecoBonusCents?: number;
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

/**
 * Rubriques de prix. Avec l'échelle de prix, le plafond (prix partenaire prévisionnel) peut dépasser le prix accepté :
 * on montre alors les trois montants, comme une confirmation de course classique. Sinon, le prix client, la commission et le net.
 */
export function priceLines(ride: RideForMessage, showClientPrice = driverSeesClientPrice()): string[] {
  const eco = ride.ecoBonusCents && ride.ecoBonusCents > 0 ? [`dont prime écologique (véhicule électrique) : ${money(ride.ecoBonusCents)}`] : [];
  return [...baseLines(ride, showClientPrice), ...eco];
}

function baseLines(ride: RideForMessage, showClientPrice: boolean): string[] {
  if (!showClientPrice) return [`Votre rémunération (net) : ${money(ride.driverNetCents)}`];
  if (ride.driverCapCents > ride.driverNetCents) {
    return [
      `Prix client (TTC) : ${money(ride.priceCents)}`,
      `Prix partenaire prévisionnel (plafond) : ${money(ride.driverCapCents)}`,
      `Prix partenaire accepté (votre rémunération) : ${money(ride.driverNetCents)}`,
    ];
  }
  return [`Prix client (TTC) : ${money(ride.priceCents)}`, `Commission de la plateforme : ${money(ride.commissionCents)}`, `Votre rémunération (net) : ${money(ride.driverNetCents)}`];
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

/**
 * Message au chauffeur à chaque changement d'état du vol (retard, avance, retour à l'heure, atterrissage, annulation).
 * Fonction pure : testable sans base de données.
 */
export interface FlightChange {
  flightNumber: string; status: string; delayMin: number; earlyMin: number;
  estimatedArrivalAt: Date | null; scheduledLanding: Date; pickupAt: Date; bufferMin: number;
}
export function flightMessage(f: FlightChange) {
  const pickup = fmtTime(new Date(f.pickupAt.getTime() + f.delayMin * 60_000));
  const est = f.estimatedArrivalAt ? fmtTime(f.estimatedArrivalAt) : null;
  if (f.status === "CANCELLED") {
    return {
      type: "FLIGHT_CANCELLED", title: `Vol ${f.flightNumber} annulé`,
      body: "Le vol est annulé : le client ne sera pas à l'arrivée. Ne vous déplacez pas avant d'avoir reçu la consigne de l'équipe ; la mission reste inscrite à votre agenda en attendant la décision du partenaire.",
    };
  }
  if (f.status === "LANDED") {
    const after = f.bufferMin > 0 ? `, ${f.bufferMin} min après l'atterrissage` : "";
    return {
      type: "FLIGHT_LANDED", title: `Vol ${f.flightNumber} atterri`,
      body: `Le vol est posé${est ? ` (${est})` : ""}. Prise en charge prévue à ${pickup}${after}. Rendez-vous au point convenu.`,
    };
  }
  if (f.delayMin > 0) {
    return { type: "FLIGHT_UPDATE", title: `Vol ${f.flightNumber} retardé (+${f.delayMin} min)`, body: `Nouvelle prise en charge prévue à ${pickup}.` };
  }
  if (f.status === "EARLY" && f.earlyMin > 0) {
    const landing = est ?? fmtTime(new Date(f.scheduledLanding.getTime() - f.earlyMin * 60_000));
    return {
      type: "FLIGHT_EARLY", title: `Vol ${f.flightNumber} en avance (−${f.earlyMin} min)`,
      body: `Atterrissage estimé à ${landing}. Le client pourrait être disponible plus tôt ; l'heure de prise en charge convenue reste ${pickup}. Soyez sur place un peu avant.`,
    };
  }
  return { type: "FLIGHT_UPDATE", title: `Vol ${f.flightNumber} : de nouveau à l'heure`, body: `La prise en charge est de nouveau prévue à ${pickup}.` };
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


/** Message au voyageur avec son lien de suivi (SMS court + e-mail). Français pour « fr », anglais sinon. Fonction pure. */
export function trackingMessage(
  b: { firstName: string; language: string; reference: string; pickupAt: Date; pickup: string; dropoff: string; url: string },
  brand = process.env.BRAND_NAME ?? "CliCab",
) {
  const fr = b.language === "fr";
  const when = b.pickupAt.toLocaleString(fr ? "fr-FR" : "en-GB", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const short = b.pickupAt.toLocaleString(fr ? "fr-FR" : "en-GB", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (fr) {
    return {
      sms: `${brand} : trajet ${b.reference} confirmé le ${short}. Suivez votre chauffeur : ${b.url}`,
      subject: `Votre trajet ${b.reference} est confirmé`,
      text: [`Bonjour ${b.firstName},`, "", `Votre trajet est confirmé : ${when}.`, `Départ : ${b.pickup}`, `Arrivée : ${b.dropoff}`, "",
        "Suivez votre chauffeur (nom, photo si le chauffeur l'a acceptée, véhicule, plaque, vol) sur cette page personnelle :", b.url, "",
        "Ne partagez pas ce lien : il donne accès à votre trajet.", "", `— ${brand}`].join("\n"),
    };
  }
  return {
    sms: `${brand}: ride ${b.reference} confirmed for ${short}. Track your driver: ${b.url}`,
    subject: `Your ride ${b.reference} is confirmed`,
    text: [`Hello ${b.firstName},`, "", `Your ride is confirmed: ${when}.`, `Pick-up: ${b.pickup}`, `Drop-off: ${b.dropoff}`, "",
      "Track your driver (name, photo if the driver has agreed, vehicle, plate, flight) on this personal page:", b.url, "",
      "Please do not share this link: it gives access to your ride.", "", `— ${brand}`].join("\n"),
  };
}


/** SMS d'alerte au voyageur (une seule phrase, lien de suivi en fin). Français pour « fr », anglais sinon. Fonction pure. */
export function passengerAlertSms(
  a: { kind: "ARRIVED"; language: string; driverFirstName: string; vehicle: string | null; plate: string | null; url: string }
   | { kind: "FLIGHT_DELAY"; language: string; flightNumber: string; delayMin: number; pickupAt: Date; url: string },
  brand = process.env.BRAND_NAME ?? "CliCab",
) {
  const fr = a.language === "fr";
  if (a.kind === "ARRIVED") {
    const car = [a.vehicle, a.plate].filter(Boolean).join(" ");
    return fr
      ? `${brand} : ${a.driverFirstName}, votre chauffeur, est arrivé${car ? ` (${car})` : ""}. Il vous attend, pancarte à votre nom. ${a.url}`
      : `${brand}: ${a.driverFirstName}, your driver, has arrived${car ? ` (${car})` : ""}. They are waiting for you with a sign with your name. ${a.url}`;
  }
  const hm = a.pickupAt.toLocaleTimeString(fr ? "fr-FR" : "en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  return fr
    ? `${brand} : vol ${a.flightNumber} retardé de ${a.delayMin} min. Votre chauffeur s'adapte : prise en charge vers ${hm}. ${a.url}`
    : `${brand}: flight ${a.flightNumber} delayed by ${a.delayMin} min. Your driver adapts: pick-up around ${hm}. ${a.url}`;
}
