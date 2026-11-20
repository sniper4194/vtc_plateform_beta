import { describe, expect, it } from "vitest";
import { canTransition, QuoteRequestSchema } from "./index";

describe("RideStatus", () => {
  it("autorise le flux nominal", () => {
    expect(canTransition("CONFIRMED", "DISPATCHING")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });
  it("interdit les sauts", () => {
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
    expect(canTransition("REFUNDED", "CONFIRMED")).toBe(false);
  });
  it("permet la redistribution si le chauffeur annule", () => {
    expect(canTransition("ASSIGNED", "DISPATCHING")).toBe(true);
  });
});

describe("QuoteRequestSchema", () => {
  const ok = {
    pickup: { address: "CDG", lat: 49.0097, lng: 2.5479 },
    dropoff: { address: "Paris", lat: 48.8566, lng: 2.3522 },
    pickupAt: "2026-12-01T10:00:00Z",
    category: "BERLINE",
    passengers: 2,
  };
  it("accepte une demande valide", () => {
    expect(QuoteRequestSchema.parse(ok).luggage).toBe(0);
  });
  it("rejette trop de passagers", () => {
    expect(QuoteRequestSchema.safeParse({ ...ok, passengers: 20 }).success).toBe(false);
  });
});
