/**
 * Critères d'admission d'un véhicule.
 * ATTENTION : les valeurs par défaut sont celles d'une charte de 2012 (Allocab) et n'ont PAS été revérifiées dans les textes en vigueur.
 * Elles sont réglables par l'environnement : à confirmer par un juriste avant le pilote.
 * VEHICLE_RULES=0 désactive le contrôle (développement, tests).
 */
const num = (k: string, d: number) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : d);

export const VEHICLE_RULES = {
  get enabled() { return process.env.VEHICLE_RULES !== "0"; },
  get minSeats() { return num("VEHICLE_MIN_SEATS", 4); }, // places, chauffeur compris
  get maxSeats() { return num("VEHICLE_MAX_SEATS", 9); },
  get maxAgeYears() { return num("VEHICLE_MAX_AGE_YEARS", 6); }, // strictement inférieur à
  get minDoors() { return num("VEHICLE_MIN_DOORS", 4); },
  get minLengthMm() { return num("VEHICLE_MIN_LENGTH_MM", 4500); },
  get minWidthMm() { return num("VEHICLE_MIN_WIDTH_MM", 1700); },
  get minPowerKw() { return num("VEHICLE_MIN_POWER_KW", 88); }, // strictement supérieure à
};

export interface VehicleFacts {
  seats: number; firstRegistrationYear: number | null; doors: number | null; lengthMm: number | null; widthMm: number | null; powerKw: number | null;
}
export interface VehicleCheck { ok: boolean; problems: string[] }

/** Contrôle un véhicule. Une information absente compte comme un défaut : on ne présume pas de la conformité. */
export function checkVehicle(v: VehicleFacts, now = new Date()): VehicleCheck {
  if (!VEHICLE_RULES.enabled) return { ok: true, problems: [] };
  const R = VEHICLE_RULES, p: string[] = [];
  if (v.seats < R.minSeats || v.seats > R.maxSeats) p.push(`Nombre de places (${v.seats}) : entre ${R.minSeats} et ${R.maxSeats}, chauffeur compris`);
  if (v.firstRegistrationYear == null) p.push("Année de première mise en circulation à renseigner");
  else if (now.getFullYear() - v.firstRegistrationYear >= R.maxAgeYears) p.push(`Véhicule trop ancien (mis en circulation en ${v.firstRegistrationYear}) : moins de ${R.maxAgeYears} ans`);
  if (v.doors == null) p.push("Nombre de portes à renseigner");
  else if (v.doors < R.minDoors) p.push(`Portes (${v.doors}) : au moins ${R.minDoors}`);
  if (v.lengthMm == null) p.push("Longueur hors tout à renseigner");
  else if (v.lengthMm < R.minLengthMm) p.push(`Longueur (${v.lengthMm} mm) : au moins ${R.minLengthMm} mm`);
  if (v.widthMm == null) p.push("Largeur hors tout à renseigner");
  else if (v.widthMm < R.minWidthMm) p.push(`Largeur (${v.widthMm} mm) : au moins ${R.minWidthMm} mm`);
  if (v.powerKw == null) p.push("Puissance nette à renseigner");
  else if (v.powerKw <= R.minPowerKw) p.push(`Puissance (${v.powerKw} kW) : strictement supérieure à ${R.minPowerKw} kW`);
  return { ok: p.length === 0, problems: p };
}

/** Premier véhicule actif de la catégorie qui respecte les critères. */
export function firstCompliant<T extends VehicleFacts & { active: boolean; category: string }>(vehicles: T[], category: string): T | undefined {
  return vehicles.find((v) => v.active && v.category === category && checkVehicle(v).ok);
}
