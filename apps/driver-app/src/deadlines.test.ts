import { describe, expect, it } from "vitest";
import { deadlineSummary, deadlineText } from "./deadlinesFormat";

describe("échéances (affichage)", () => {
  it("textes", () => {
    expect(deadlineText({ status: "MISSING", daysLeft: null, expiresAt: null })).toBe("Document manquant");
    expect(deadlineText({ status: "PENDING", daysLeft: null, expiresAt: null })).toContain("validation");
    expect(deadlineText({ status: "SOON", daysLeft: 1, expiresAt: "2026-12-02T00:00:00Z" })).toContain("demain");
    expect(deadlineText({ status: "SOON", daysLeft: 12, expiresAt: "2026-12-13T00:00:00Z" })).toContain("12 jours");
    expect(deadlineText({ status: "OK", daysLeft: 200, expiresAt: "2027-06-01T00:00:00Z" })).toContain("Valable jusqu'au");
    expect(deadlineText({ status: "EXPIRED", daysLeft: -2, expiresAt: "2026-11-29T00:00:00Z" })).toContain("Expiré le");
  });
  it("résumé : l'urgent d'abord", () => {
    const d = (status: any) => ({ type: "x", label: "x", status, daysLeft: 5, expiresAt: null });
    expect(deadlineSummary(null)).toBe("…");
    expect(deadlineSummary([d("OK")])).toBe("Tout est à jour");
    expect(deadlineSummary([d("OK"), d("SOON")])).toContain("à renouveler");
    expect(deadlineSummary([d("SOON"), d("EXPIRED")])).toContain("expiré");
  });
});
