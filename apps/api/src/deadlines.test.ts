import { describe, expect, it } from "vitest";
import { daysLeft, deadlineStatus, expiryMessage, thresholdFor } from "./deadlines";

const now = new Date("2026-12-01T10:00:00Z");
const inDays = (n: number) => new Date(now.getTime() + n * 86400_000);

describe("échéances de documents", () => {
  it("palier de rappel : 30, 14, 7, 1 jours, puis le jour même et après", () => {
    expect(thresholdFor(45)).toBeNull();
    expect(thresholdFor(31)).toBeNull();
    expect(thresholdFor(30)).toBe(30);
    expect(thresholdFor(20)).toBe(30);
    expect(thresholdFor(14)).toBe(14);
    expect(thresholdFor(8)).toBe(14);
    expect(thresholdFor(7)).toBe(7);
    expect(thresholdFor(2)).toBe(7);
    expect(thresholdFor(1)).toBe(1);
    expect(thresholdFor(0)).toBe(0);
    expect(thresholdFor(-12)).toBe(0);
  });
  it("jours restants arrondis au supérieur", () => {
    expect(daysLeft(inDays(10), now)).toBe(10);
    expect(daysLeft(new Date(now.getTime() + 3600_000), now)).toBe(1);
    expect(daysLeft(new Date(now.getTime() - 3600_000), now)).toBe(0);
  });
  it("état d'un document", () => {
    expect(deadlineStatus(null, now).status).toBe("MISSING");
    expect(deadlineStatus({ status: "PENDING", expiresAt: inDays(200) }, now).status).toBe("PENDING");
    expect(deadlineStatus({ status: "APPROVED", expiresAt: inDays(200) }, now).status).toBe("OK");
    expect(deadlineStatus({ status: "APPROVED", expiresAt: inDays(12) }, now)).toEqual({ status: "SOON", days: 12 });
    expect(deadlineStatus({ status: "APPROVED", expiresAt: inDays(-3) }, now).status).toBe("EXPIRED");
    expect(deadlineStatus({ status: "APPROVED", expiresAt: null }, now).status).toBe("OK");
  });
  it("messages : contrôle technique et carte professionnelle ont leur conseil, l'expiration met hors ligne", () => {
    const ct = expiryMessage("TECHNICAL_INSPECTION", 7, inDays(7));
    expect(ct.title).toBe("Contrôle technique : échéance dans 7 jours");
    expect(ct.body).toContain("aucun rappel officiel");
    expect(expiryMessage("VTC_CARD", 30, inDays(30)).body).toContain("14 heures");
    expect(expiryMessage("INSURANCE", 1, inDays(1)).title).toContain("demain");
    const done = expiryMessage("TECHNICAL_INSPECTION", 0, inDays(-1));
    expect(done.type).toBe("DOC_EXPIRED");
    expect(done.body).toContain("hors ligne");
    expect(done.body).toContain("immobilise");
  });
});
