/**
 * Critères d'admission d'un véhicule.
 * SOURCE : fiche Service-Public « Devenir chauffeur de VTC » (vérifiée le 12/08/2026), qui renvoie à l'arrêté du 26 mars 2015 (ancienneté, dimensions, puissance)
 * et au Code des transports (art. L3122-1 à L3122-9, R3122-1 à R3122-5-1). Le texte des arrêtés n'a pas été lu directement : confirmation par un juriste avant le pilote.
 * Tout est réglable par l'environnement.
 * VEHICLE_RULES=0 désactive le contrôle (développement, tests).
 */
const num = (k: string, d: number) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : d);

export const VEHICLE_RULES = {
  get enabled() { return process.env.VEHICLE_RULES !== "0"; },
  get minSeats() { return num("VEHICLE_MIN_SEATS", 4); }, // places, chauffeur compris
  get maxSeats() { return num("VEHICLE_MAX_SEATS", 9); },
  get maxAgeYears() { return num("VEHICLE_MAX_AGE_YEARS", 7); }, // strictement moins de, depuis la première mise en circulation
  get minDoors() { return num("VEHICLE_MIN_DOORS", 4); },
  get minLengthMm() { return num("VEHICLE_MIN_LENGTH_MM", 4500); },
  get minWidthMm() { return num("VEHICLE_MIN_WIDTH_MM", 1700); },
  get minPowerKw() { return num("VEHICLE_MIN_POWER_KW", 84); }, // au moins
};

export type Fuel = "THERMAL" | "HYBRID" | "ELECTRIC";
export interface VehicleFacts {
  seats: number; collector?: boolean; fuel: Fuel | null; firstRegistrationAt: Date | null; doors: number | null; lengthMm: number | null; widthMm: number | null; powerKw: number | null;
}
export interface VehicleCheck { ok: boolean; problems: string[] }

const addYears = (d: Date, n: number) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };

/**
 * Contrôle un véhicule. Une information absente compte comme un défaut : on ne présume pas de la conformité.
 * Hybrides et électriques : exemptés d'âge, de puissance et de dimensions ; places et portes restent exigées. Collection : exemptée d'âge seulement.
 */
export function checkVehicle(v: VehicleFacts, now = new Date()): VehicleCheck {
  if (!VEHICLE_RULES.enabled) return { ok: true, problems: [] };
  const R = VEHICLE_RULES, p: string[] = [];
  if (v.seats < R.minSeats || v.seats > R.maxSeats) p.push(`Nombre de places (${v.seats}) : entre ${R.minSeats} et ${R.maxSeats}, chauffeur compris`);
  if (v.doors == null) p.push("Nombre de portes à renseigner");
  else if (v.doors < R.minDoors) p.push(`Portes (${v.doors}) : au moins ${R.minDoors}`);
  if (v.fuel == null) { p.push("Motorisation à renseigner (thermique, hybride ou électrique)"); }
  const exempt = v.fuel === "HYBRID" || v.fuel === "ELECTRIC";
  if (!exempt) {
    if (v.collector) { /* voiture de collection : limite d'âge non applicable */ }
    else if (v.firstRegistrationAt == null) p.push("Date de première mise en circulation à renseigner (champ B de la carte grise)");
    else if (addYears(v.firstRegistrationAt, R.maxAgeYears) <= now) p.push(`Véhicule trop ancien (première mise en circulation le ${v.firstRegistrationAt.toISOString().slice(0, 10)}) : moins de ${R.maxAgeYears} ans`);
    if (v.lengthMm == null) p.push("Longueur hors tout à renseigner");
    else if (v.lengthMm < R.minLengthMm) p.push(`Longueur (${v.lengthMm} mm) : au moins ${R.minLengthMm} mm`);
    if (v.widthMm == null) p.push("Largeur hors tout à renseigner");
    else if (v.widthMm < R.minWidthMm) p.push(`Largeur (${v.widthMm} mm) : au moins ${R.minWidthMm} mm`);
    if (v.powerKw == null) p.push("Puissance nette à renseigner");
    else if (v.powerKw < R.minPowerKw) p.push(`Puissance (${v.powerKw} kW) : au moins ${R.minPowerKw} kW`);
  }
  return { ok: p.length === 0, problems: p };
}

/**
 * Le véhicule a-t-il tous les équipements demandés (siège enfant, fauteuil roulant…) ?
 * TPMR (passager qui reste dans son fauteuil) : la déclaration du chauffeur ne suffit pas, il faut la validation de la tour.
 */
export const hasNeeds = (v: { features?: string[] | null; tpmrVerifiedAt?: Date | null }, needs: readonly string[] = []) =>
  needs.filter((n) => n !== "WOMEN_DRIVER").every((n) => (v.features ?? []).includes(n) && (n !== "TPMR" || !!v.tpmrVerifiedAt));

/** CliCab Women : la course demande une conductrice validée par la tour. Sans chauffeur connu, refus (prudence). */
export const driverFits = (driver: { womanVerifiedAt?: Date | null } | null | undefined, needs: readonly string[] = []) =>
  !needs.includes("WOMEN_DRIVER") || !!driver?.womanVerifiedAt;

/** Premier véhicule actif de la catégorie qui respecte les critères et porte les équipements demandés. */
export function firstCompliant<T extends VehicleFacts & { active: boolean; category: string; features?: string[] | null; tpmrVerifiedAt?: Date | null }>(vehicles: T[], category: string, needs: readonly string[] = [], driver?: { womanVerifiedAt?: Date | null } | null): T | undefined {
  // Le chauffeur doit aussi convenir (CliCab Women) : un appel qui oublie de le passer exclut la course « conductrice ».
  if (!driverFits(driver, needs)) return undefined;
  return vehicles.find((v) => v.active && v.category === category && checkVehicle(v).ok && hasNeeds(v, needs));
}
