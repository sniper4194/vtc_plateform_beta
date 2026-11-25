/**
 * Alerte d'atterrissage : quand le serveur signale qu'un vol d'une de vos missions est posé (message « FLIGHT_LANDED »),
 * l'application joue le son d'atterrissage. Fonction pure : quels messages méritent le son.
 * Un message n'est sonné qu'une fois, et jamais s'il existait déjà au lancement de l'application (pas de rafale au démarrage).
 */
export interface Notice { id: string; type: string; title: string; createdAt: string }

export function newLandings(items: Notice[], seen: Set<string>, startedAt: number): Notice[] {
  return items.filter((n) => n.type === "FLIGHT_LANDED" && !seen.has(n.id) && new Date(n.createdAt).getTime() >= startedAt);
}

/** Nouvelles offres de course : celles qu'on n'a pas encore signalées. Le premier passage sert de référence (pas de son au lancement). */
export interface OfferLite { offerId: string; pickup: string; dropoff: string; netCents: number }
export function newOffers(list: OfferLite[], seen: Set<string>): OfferLite[] {
  return list.filter((o) => !seen.has(o.offerId));
}

export const offerToast = (o: OfferLite, count: number) =>
  `🚖 Nouvelle course : ${o.pickup} → ${o.dropoff} · ${(o.netCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}${count > 1 ? ` (+${count - 1})` : ""}`;
