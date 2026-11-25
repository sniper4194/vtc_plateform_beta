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

describe("objet oublié", () => {
  it("chaque état du signalement a un texte en français et en anglais", () => {
    for (const s of ["OPEN", "FOUND", "NOT_FOUND", "RETURNED", "CLOSED"]) {
      expect(text("fr").lostStatus[s]).toBeTruthy();
      expect(text("en").lostStatus[s]).toBeTruthy();
    }
    expect(text("fr").lostHint(7)).toMatch(/7 jours/);
  });
});
