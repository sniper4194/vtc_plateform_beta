export interface Zone { code: string; lat: number; lng: number; radiusKm: number }

/** Zones simplifiées (cercles). Ordre = priorité ; PARIS en dernier car la plus large. */
export const ZONES: Zone[] = [
  { code: "CDG", lat: 49.0097, lng: 2.5479, radiusKm: 5 },
  { code: "ORLY", lat: 48.7262, lng: 2.3652, radiusKm: 4 },
  { code: "BEAUVAIS", lat: 49.4544, lng: 2.1128, radiusKm: 4 },
  { code: "GARE_LYON", lat: 48.8443, lng: 2.3744, radiusKm: 0.6 },
  { code: "GARE_NORD", lat: 48.8809, lng: 2.3553, radiusKm: 0.6 },
  { code: "PARIS", lat: 48.8566, lng: 2.3522, radiusKm: 10 },
];

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function zoneOf(p: { lat: number; lng: number }): string | undefined {
  return ZONES.find((z) => haversineKm(p, z) <= z.radiusKm)?.code;
}

/** Toutes les zones contenant le point, de la plus précise à la plus large (ex. GARE_NORD puis PARIS). */
export function zonesOf(p: { lat: number; lng: number }): string[] {
  return ZONES.filter((z) => haversineKm(p, z) <= z.radiusKm).map((z) => z.code);
}
