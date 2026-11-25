import { describe, expect, it } from "vitest";
import { fatigueBlocks, lastDayMinutes, planningConfig, returnMatch, worstDayMinutes } from "./planning";

const H = 3600_000;
const slot = (startH: number, hours: number) => ({ start: startH * H, end: (startH + hours) * H });

describe("garde-fou fatigue", () => {
  it("additionne les missions de la pire période de 24 h contenant la nouvelle", () => {
    expect(worstDayMinutes([], slot(10, 2))).toBe(120);
    expect(worstDayMinutes([slot(0, 3), slot(5, 3)], slot(10, 2))).toBe(8 * 60);
    // une mission 30 h plus tôt ne compte pas
    expect(worstDayMinutes([slot(-30, 4)], slot(10, 2))).toBe(120);
    // la période glisse : on regarde aussi après la nouvelle mission
    expect(worstDayMinutes([slot(20, 5), slot(30, 4)], slot(10, 2))).toBe(11 * 60);
  });
  it("ne compte que la partie d'une mission comprise dans la période", () => {
    // mission de -16 h à -12 h : la période qui finit à 12 h (fin du nouveau créneau) n'en garde rien ; celle qui commence à -12 h, si
    expect(worstDayMinutes([slot(-16, 4)], slot(10, 2))).toBe(120);
    expect(worstDayMinutes([slot(-13, 2)], slot(10, 2))).toBe(120 + 60);
  });
  it("bloque au-delà du maximum, pas en deçà ; 0 désactive", () => {
    const day = [slot(0, 4), slot(5, 4)]; // 8 h
    expect(fatigueBlocks(day, slot(10, 2), 10)).toBe(false); // 10 h pile : autorisé
    expect(fatigueBlocks(day, slot(10, 2.5), 10)).toBe(true); // 10 h 30
    expect(fatigueBlocks(day, slot(10, 20), 0)).toBe(false);
  });
  it("valeurs par défaut lisibles et réglables", () => {
    expect(planningConfig({} as any)).toEqual({ maxMissionHours: 10, returnRadiusKm: 3, returnWindowMin: 120 });
    expect(planningConfig({ FATIGUE_MAX_MISSION_HOURS: "0", RETURN_RADIUS_KM: "5", RETURN_WINDOW_MIN: "90" } as any)).toEqual({ maxMissionHours: 0, returnRadiusKm: 5, returnWindowMin: 90 });
  });
  it("affiche le temps de mission des 24 dernières heures", () => {
    expect(lastDayMinutes([slot(0, 3), slot(-30, 5), slot(23, 3)], 24 * H)).toBe(3 * 60 + 60);
  });
});

describe("missions de retour", () => {
  const cdg = { lat: 49.0097, lng: 2.5479 };
  const planned = [
    { ref: 1, dropLat: cdg.lat, dropLng: cdg.lng, endAt: 10 * H },
    { ref: 2, dropLat: 48.8566, dropLng: 2.3522, endAt: 11 * H }, // Paris : trop loin de Roissy
  ];
  const cfg = { maxMissionHours: 10, returnRadiusKm: 3, returnWindowMin: 120 };
  it("repère la mission qui finit près du départ de l'offre, peu avant", () => {
    expect(returnMatch(planned, { pickupLat: 49.008, pickupLng: 2.55, startAt: 10.75 * H }, cfg)).toMatchObject({ afterRef: 1, gapMin: 45 });
  });
  it("ignore une offre trop tardive, antérieure, ou trop loin", () => {
    expect(returnMatch(planned, { pickupLat: cdg.lat, pickupLng: cdg.lng, startAt: 13 * H }, cfg)).toBeNull(); // 3 h après
    expect(returnMatch(planned, { pickupLat: cdg.lat, pickupLng: cdg.lng, startAt: 9 * H }, cfg)).toBeNull(); // avant la fin
    expect(returnMatch(planned, { pickupLat: 48.95, pickupLng: 2.45, startAt: 10.5 * H }, cfg)).toBeNull(); // ~10 km
  });
  it("préfère l'écart le plus court quand plusieurs missions conviennent", () => {
    const two = [{ ref: 7, dropLat: cdg.lat, dropLng: cdg.lng, endAt: 9 * H }, { ref: 8, dropLat: cdg.lat, dropLng: cdg.lng, endAt: 10 * H }];
    expect(returnMatch(two, { pickupLat: cdg.lat, pickupLng: cdg.lng, startAt: 10.5 * H }, cfg)?.afterRef).toBe(8);
  });
});
