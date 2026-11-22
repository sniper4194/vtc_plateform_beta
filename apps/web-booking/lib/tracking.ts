export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export type Lang = "fr" | "en";
export interface Tracking {
  language: Lang; reference: string; status: string; passengerFirstName: string;
  pickup: string; dropoff: string; pickupAt: string; signText: string; notes: string | null;
  flight: { number: string; status: string; delayMin: number; earlyMin: number } | null;
  driver: { firstName: string; vehicle: string | null; plate: string | null; photoUrl: string | null } | null;
}

/** Étapes affichées au voyageur, dans l'ordre. */
export const STEPS = ["CONFIRMED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"] as const;
export type Step = (typeof STEPS)[number];

const T = {
  fr: {
    title: "Votre trajet", ref: "Référence",
    CONFIRMED: "Réservation confirmée", DISPATCHING: "Réservation confirmée", ASSIGNED: "Chauffeur attribué", EN_ROUTE: "Votre chauffeur est en route", ARRIVED: "Votre chauffeur est arrivé", IN_PROGRESS: "En route vers votre destination", COMPLETED: "Course terminée",
    CANCELLED: "Réservation annulée", NO_SHOW: "Course clôturée (voyageur absent)",
    sub: {
      CONFIRMED: "Nous cherchons le chauffeur le plus proche. Le nom et la photo apparaîtront ici.", ASSIGNED: "Votre chauffeur se prépare. Il sera là à l’heure convenue.", EN_ROUTE: "Il se dirige vers votre point de rendez-vous.", ARRIVED: "Il vous attend. Repérez la pancarte à votre nom.", IN_PROGRESS: "Bon voyage !", COMPLETED: "Merci d’avoir voyagé avec nous.",
    } as Record<string, string>,
    short: { CONFIRMED: "Confirmée", ASSIGNED: "Attribuée", EN_ROUTE: "En route", ARRIVED: "Sur place", IN_PROGRESS: "En course", COMPLETED: "Terminée" } as Record<Step, string>,
    from: "Prise en charge", to: "Destination", at: "Heure", sign: "Pancarte à votre nom", notes: "Consignes de rendez-vous",
    driver: "Votre chauffeur", vehicle: "Véhicule", plate: "Plaque", noPhoto: "Photo non communiquée",
    flight: "Vol", flightStatus: { SCHEDULED: "À l’heure", DELAYED: "Retardé", EARLY: "En avance", LANDED: "Atterri", CANCELLED: "Annulé" } as Record<string, string>,
    flightDelay: (m: number) => `Retard de ${m} min : votre chauffeur s’adapte, l’heure de prise en charge est décalée.`,
    flightEarly: (m: number) => `Atterrissage en avance de ${m} min. L’heure de prise en charge convenue ne change pas.`,
    privacy: "Pour votre sécurité, la photo n’est visible que pendant votre course. Ce lien est personnel : ne le partagez pas.",
    notFound: "Ce lien de suivi n’existe pas ou n’est plus valide.", offline: "Connexion impossible pour le moment. Nouvel essai automatique…",
    loading: "Chargement…", updated: "Mis à jour",
  },
  en: {
    title: "Your ride", ref: "Reference",
    CONFIRMED: "Booking confirmed", DISPATCHING: "Booking confirmed", ASSIGNED: "Driver assigned", EN_ROUTE: "Your driver is on the way", ARRIVED: "Your driver has arrived", IN_PROGRESS: "On the way to your destination", COMPLETED: "Ride completed",
    CANCELLED: "Booking cancelled", NO_SHOW: "Ride closed (passenger not found)",
    sub: {
      CONFIRMED: "We are finding the closest driver. Their name and photo will appear here.", ASSIGNED: "Your driver is getting ready and will be there on time.", EN_ROUTE: "They are heading to your meeting point.", ARRIVED: "They are waiting for you. Look for the sign with your name.", IN_PROGRESS: "Have a good trip!", COMPLETED: "Thank you for riding with us.",
    } as Record<string, string>,
    short: { CONFIRMED: "Confirmed", ASSIGNED: "Assigned", EN_ROUTE: "On the way", ARRIVED: "Arrived", IN_PROGRESS: "In ride", COMPLETED: "Done" } as Record<Step, string>,
    from: "Pick-up", to: "Drop-off", at: "Time", sign: "Name sign", notes: "Meeting instructions",
    driver: "Your driver", vehicle: "Vehicle", plate: "Plate", noPhoto: "Photo not shared",
    flight: "Flight", flightStatus: { SCHEDULED: "On time", DELAYED: "Delayed", EARLY: "Early", LANDED: "Landed", CANCELLED: "Cancelled" } as Record<string, string>,
    flightDelay: (m: number) => `Delayed ${m} min: your driver adapts and the pick-up time moves accordingly.`,
    flightEarly: (m: number) => `Landing ${m} min early. The agreed pick-up time does not change.`,
    privacy: "For your safety, the photo is only visible during your ride. This link is personal: please do not share it.",
    notFound: "This tracking link does not exist or is no longer valid.", offline: "Cannot connect right now. Retrying automatically…",
    loading: "Loading…", updated: "Updated",
  },
};
export const text = (l: Lang) => T[l] ?? T.fr;

/** Position dans la frise (0 à 5) ; null pour une réservation annulée ou clôturée sans course. */
export function stepIndex(status: string): number | null {
  if (status === "DISPATCHING") return 0;
  const i = STEPS.indexOf(status as Step);
  return i >= 0 ? i : null;
}
export const isCancelled = (s: string) => s.startsWith("CANCELLED") || s === "NO_SHOW" || s === "REFUNDED" || s === "DISPUTED";
export const headline = (l: Lang, status: string) => { const t = text(l) as any; return isCancelled(status) ? (status === "NO_SHOW" ? t.NO_SHOW : t.CANCELLED) : t[status] ?? t.CONFIRMED; };
