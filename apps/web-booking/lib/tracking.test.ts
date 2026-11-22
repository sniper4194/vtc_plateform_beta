import { describe, expect, it } from "vitest";
import { headline, isCancelled, stepIndex, text } from "./tracking";

describe("suivi voyageur", () => {
  it("place chaque statut dans la frise", () => {
    expect(stepIndex("DISPATCHING")).toBe(0);
    expect(stepIndex("ASSIGNED")).toBe(1);
    expect(stepIndex("IN_PROGRESS")).toBe(4);
    expect(stepIndex("COMPLETED")).toBe(5);
    expect(stepIndex("CANCELLED_BY_CLIENT")).toBeNull();
  });
  it("distingue les annulations", () => {
    expect(isCancelled("CANCELLED_BY_PARTNER")).toBe(true);
    expect(isCancelled("EN_ROUTE")).toBe(false);
    expect(headline("fr", "CANCELLED_BY_CLIENT")).toBe("Réservation annulée");
    expect(headline("en", "ARRIVED")).toBe("Your driver has arrived");
  });
  it("retombe sur le français pour une langue inconnue", () => {
    expect(text("de" as any).title).toBe("Votre trajet");
  });
});
