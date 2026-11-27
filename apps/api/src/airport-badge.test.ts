import { describe, expect, it } from "vitest";
import { needsAirportBadge } from "./airport-badge";

const env = { AIRPORT_BADGE_ZONES: "CDG,ORLY,BEAUVAIS" } as NodeJS.ProcessEnv;
const paris = { pickupLat: 48.8566, pickupLng: 2.3522 };

describe("courses qui exigent le badge aéroport", () => {
  it("bloque tout départ dont l'adresse contient « aéroport », quel que soit l'aéroport", () => {
    expect(needsAirportBadge({ ...paris, pickupAddress: "Aéroport de Paris-Le Bourget" }, env)).toBe(true);
    expect(needsAirportBadge({ ...paris, pickupAddress: "aeroport de Nice, terminal 1" }, env)).toBe(true);
    expect(needsAirportBadge({ ...paris, pickupAddress: "Lyon Saint-Exupéry Airport" }, env)).toBe(true);
  });
  it("bloque aussi un départ situé dans une zone d'aéroport même si l'adresse ne le dit pas", () => {
    expect(needsAirportBadge({ pickupLat: 49.0097, pickupLng: 2.5479, pickupAddress: "Terminal 2E, porte 8" }, env)).toBe(true);
    expect(needsAirportBadge({ pickupLat: 49.4544, pickupLng: 2.1128, pickupAddress: "Tillé" }, env)).toBe(true); // Beauvais
  });
  it("laisse libres les départs ailleurs, y compris vers l'aéroport", () => {
    expect(needsAirportBadge({ ...paris, pickupAddress: "10 rue de Rivoli, Paris" }, env)).toBe(false);
  });
  it("se désactive avec AIRPORT_BADGE_ENABLED=0", () => {
    expect(needsAirportBadge({ ...paris, pickupAddress: "Aéroport CDG T2" }, { ...env, AIRPORT_BADGE_ENABLED: "0" })).toBe(false);
  });
});
