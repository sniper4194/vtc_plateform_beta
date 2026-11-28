import { describe, expect, it } from "vitest";
import { looksLikeKey, shiftMonth, statementCsv, type HotelRow } from "./hotel";

const row: HotelRow = {
  id: "b1", reference: "R-1042", status: "COMPLETED", pickupAt: "2026-12-03T08:15:00.000Z", pickup: "8 rue des Glycines, Paris", dropoff: "Aéroport Paris-Orly",
  room: "Chambre 214", passenger: "Elena Moreau", flightNumber: null, payOnBoard: false, total: 52.5, cancellationFee: null, driver: null, trackingUrl: null,
};

describe("espace hôtel", () => {
  it("reconnaît le format d'une clé, sans la juger valide", () => {
    expect(looksLikeKey("vtc_live_" + "a1".repeat(24))).toBe(true);
    expect(looksLikeKey(" vtc_test_" + "0f".repeat(24) + " ")).toBe(true);
    expect(looksLikeKey("cmp_" + "a1".repeat(24))).toBe(false);
    expect(looksLikeKey("vtc_live_court")).toBe(false);
  });

  it("change de mois, passage d'année compris", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-06", 0)).toBe("2026-06");
  });

  it("relevé lisible par Excel en français, sans formule exécutable", () => {
    const csv = statementCsv([row, { ...row, reference: "R-1043", payOnBoard: true, passenger: "=HYPERLINK(\"x\")", status: "CANCELLED_BY_PARTNER", cancellationFee: 26.25 }]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("R-1042;Chambre 214;Elena Moreau;");
    expect(lines[1]).toContain("Facturé à l'hôtel;52,50;");
    expect(lines[1]).toContain("03/12"); // 9 h 15 à Paris
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[2]).toContain("Carte à bord (client);52,50;26,25");
  });
});
