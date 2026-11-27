/** Page de réservation clé en main : textes et calculs purs (testables). */
export type Lang = "fr" | "en";

/** Décalage de Paris par rapport à UTC (minutes) à un instant donné, heure d'été comprise. */
function parisOffsetMin(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(p);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 60;
}

/**
 * Date et heure saisies = heure de PARIS (le lieu du trajet), quel que soit le fuseau du téléphone du voyageur :
 * un client qui réserve depuis New York tape l'heure de sa prise en charge à Paris.
 */
export function parisToIso(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  const first = guess - parisOffsetMin(new Date(guess)) * 60_000;
  return new Date(guess - parisOffsetMin(new Date(first)) * 60_000).toISOString();
}

export const CATEGORY: Record<Lang, Record<string, string>> = {
  fr: { BERLINE: "Berline (jusqu'à 3 passagers)", BUSINESS: "Affaires", VAN: "Van (jusqu'à 7 passagers)", GREEN: "Électrique ou hybride" },
  en: { BERLINE: "Sedan (up to 3 passengers)", BUSINESS: "Business", VAN: "Van (up to 7 passengers)", GREEN: "Electric or hybrid" },
};
export const NEED: Record<Lang, Record<string, string>> = {
  fr: { CHILD_SEAT: "Siège enfant", BOOSTER: "Rehausseur", WHEELCHAIR: "Fauteuil roulant", PET: "Animal" },
  en: { CHILD_SEAT: "Child seat", BOOSTER: "Booster seat", WHEELCHAIR: "Wheelchair", PET: "Pet" },
};

export const T = {
  fr: {
    title: "Réserver un transfert", trip: "Trajet", fromHub: "Arrivée : de l'aéroport ou de la gare vers", toHub: "Départ : de", toHubTo: "vers l'aéroport ou la gare",
    hub: "Aéroport ou gare", date: "Date", time: "Heure de prise en charge (heure de Paris)", category: "Véhicule", passengers: "Passagers", luggage: "Bagages",
    flight: "Numéro de vol (facultatif)", code: "Code d'accès", codeHint: "Communiqué par l'établissement.", quote: "Voir le prix",
    price: "Prix fixe", priceNote: "Annoncé avant de réserver. Facturé à l'établissement selon ses conditions.", change: "Modifier le trajet",
    firstName: "Prénom", lastName: "Nom", phone: "Téléphone portable", email: "E-mail (facultatif)", needs: "Besoins particuliers", payOnBoard: "Je paierai à bord, par carte bancaire, auprès du chauffeur", notes: "Précisions pour le chauffeur (facultatif)",
    consent: "J'accepte que mes coordonnées soient transmises à CliCab et au chauffeur, uniquement pour organiser ce trajet.", privacy: "Politique de confidentialité",
    book: "Réserver", booked: "Réservation confirmée", ref: "Référence", track: "Suivre mon trajet", trackNote: "Gardez ce lien : vous y verrez le nom, la photo et le véhicule de votre chauffeur.",
    invalidWhen: "Date ou heure invalide.", offline: "Connexion impossible : réessayez dans un instant.", notFound: "Cette page de réservation n'existe pas ou n'est plus active.",
  },
  en: {
    title: "Book a transfer", trip: "Trip", fromHub: "Arrival: from the airport or station to", toHub: "Departure: from", toHubTo: "to the airport or station",
    hub: "Airport or station", date: "Date", time: "Pick-up time (Paris time)", category: "Vehicle", passengers: "Passengers", luggage: "Bags",
    flight: "Flight number (optional)", code: "Access code", codeHint: "Provided by the establishment.", quote: "See the price",
    price: "Fixed price", priceNote: "Shown before booking. Billed to the establishment under its own terms.", change: "Change the trip",
    firstName: "First name", lastName: "Last name", phone: "Mobile phone", email: "Email (optional)", needs: "Special needs", payOnBoard: "I will pay on board by bank card, to the driver", notes: "Notes for the driver (optional)",
    consent: "I agree that my contact details are shared with CliCab and the driver, only to organise this trip.", privacy: "Privacy policy",
    book: "Book", booked: "Booking confirmed", ref: "Reference", track: "Track my ride", trackNote: "Keep this link: it will show your driver's name, photo and vehicle.",
    invalidWhen: "Invalid date or time.", offline: "Cannot connect right now: please try again.", notFound: "This booking page does not exist or is no longer active.",
  },
};
