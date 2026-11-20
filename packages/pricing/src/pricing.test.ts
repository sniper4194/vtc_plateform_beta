import { describe, expect, it } from "vitest";
import { computeQuote, PricingConfig, FlatRate } from "./index";

const config: PricingConfig = {
  baseFare: 5,
  perKm: 1.2,
  perMinute: 0.4,
  minFare: 15,
  categoryMultiplier: { BERLINE: 1, BUSINESS: 1.3, VAN: 1.5, GREEN: 1.1 },
  nightSurcharge: 0.2,
  weekendSurcharge: 0.1,
  peakSurcharge: 0.15,
  luggageFee: 3,
  includedLuggage: 2,
  waitingPerMinute: 0.5,
  partnerMultiplier: 1,
  commissionRate: 0.2,
};
const flat: FlatRate[] = [
  { id: "cdg-paris", fromZone: "CDG", toZone: "PARIS", bidirectional: true, prices: { BERLINE: 55, VAN: 85 } },
];
// Mercredi 2026-11-18 14:00 UTC (15h Paris)
const weekday = new Date("2026-11-18T14:00:00Z");

describe("computeQuote", () => {
  it("calcule un tarif au compteur", () => {
    const q = computeQuote({ distanceKm: 10, durationMin: 20, category: "BERLINE", pickupAt: weekday }, config);
    expect(q.total).toBe(25); // 5 + 12 + 8
    expect(q.commission).toBe(5);
    expect(q.driverNet).toBe(20);
  });
  it("applique le minimum de course", () => {
    const q = computeQuote({ distanceKm: 1, durationMin: 2, category: "BERLINE", pickupAt: weekday }, config);
    expect(q.total).toBe(15);
  });
  it("applique le coefficient catégorie", () => {
    const q = computeQuote({ distanceKm: 10, durationMin: 20, category: "BUSINESS", pickupAt: weekday }, config);
    expect(q.total).toBe(32.5);
  });
  it("applique la majoration de nuit (heure de Paris)", () => {
    // 21:30 UTC = 22:30 Paris
    const q = computeQuote({ distanceKm: 10, durationMin: 20, category: "BERLINE", pickupAt: new Date("2026-11-18T21:30:00Z") }, config);
    expect(q.total).toBe(30);
  });
  it("applique la majoration week-end", () => {
    const q = computeQuote({ distanceKm: 10, durationMin: 20, category: "BERLINE", pickupAt: new Date("2026-11-21T14:00:00Z") }, config);
    expect(q.total).toBe(27.5);
  });
  it("utilise le forfait aéroport dans les deux sens, sans majoration", () => {
    const q = computeQuote(
      { distanceKm: 40, durationMin: 50, category: "BERLINE", pickupAt: new Date("2026-11-18T21:30:00Z"), fromZone: "PARIS", toZone: "CDG" },
      config,
      flat,
    );
    expect(q.total).toBe(55);
    expect(q.flatRateId).toBe("cdg-paris");
  });
  it("retombe sur le compteur si pas de forfait pour la catégorie", () => {
    const q = computeQuote(
      { distanceKm: 10, durationMin: 20, category: "BUSINESS", pickupAt: weekday, fromZone: "CDG", toZone: "PARIS" },
      config,
      flat,
    );
    expect(q.flatRateId).toBeUndefined();
    expect(q.total).toBe(32.5);
  });
  it("facture bagages au-delà du quota et l'attente", () => {
    const q = computeQuote({ distanceKm: 10, durationMin: 20, category: "BERLINE", pickupAt: weekday, luggage: 4, waitingMinutes: 10 }, config);
    expect(q.total).toBe(36); // 25 + 6 + 5
  });
  it("applique le coefficient partenaire", () => {
    const q = computeQuote({ distanceKm: 10, durationMin: 20, category: "BERLINE", pickupAt: weekday }, { ...config, partnerMultiplier: 0.9 });
    expect(q.total).toBe(22.5);
  });
  it("refuse les valeurs négatives", () => {
    expect(() => computeQuote({ distanceKm: -1, durationMin: 5, category: "BERLINE", pickupAt: weekday }, config)).toThrow(RangeError);
  });
});
