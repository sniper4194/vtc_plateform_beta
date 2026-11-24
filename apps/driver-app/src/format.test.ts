import { describe, expect, it } from "vitest";
import { normalizeApiUrl, countdown, dayLabel, delayLabel, flightLabel, hoursLabel, isCancelled, STATUS_LABEL, eurShort, fuseFraction, groupByDay, NEXT_ACTION, secondsUntil, stepIndex, timeOf, waitedMin, whenLabel, swapState } from "./format";

describe("format", () => {
  it("compte à rebours mm:ss", () => {
    expect(countdown(57)).toBe("00:57");
    expect(countdown(300)).toBe("05:00");
    expect(countdown(-3)).toBe("00:00");
  });
  it("libellé de date relatif", () => {
    const now = new Date(2026, 10, 20, 12, 0);
    expect(whenLabel(new Date(2026, 10, 21, 4, 10).toISOString(), now)).toBe("Demain · 04:10");
    expect(whenLabel(new Date(2026, 10, 20, 18, 5).toISOString(), now)).toBe("Ce jour · 18:05");
  });
  it("montants", () => {
    expect(eurShort(4400)).toBe("44 €");
    expect(eurShort(4450).replace(/\s/g, " ")).toContain("44,50");
  });
  it("étapes de mission alignées sur l'API", () => {
    expect(NEXT_ACTION("ASSIGNED")?.action).toBe("en-route");
    expect(NEXT_ACTION("IN_PROGRESS")?.action).toBe("complete");
    expect(NEXT_ACTION("COMPLETED")).toBeUndefined();
    expect(stepIndex("ARRIVED")).toBe(2);
  });
  it("mèche : fraction bornée", () => {
    expect(fuseFraction(150, 300)).toBe(0.5);
    expect(fuseFraction(-5, 300)).toBe(0);
    expect(fuseFraction(999, 300)).toBe(1);
  });
  it("regroupe par jour en conservant l'ordre", () => {
    const now = new Date(2026, 10, 20, 12, 0);
    const mk = (d: number, h: number) => ({ at: new Date(2026, 10, d, h, 0).toISOString() });
    const secs = groupByDay([mk(21, 4), mk(21, 13), mk(22, 6)], (x) => x.at, now);
    expect(secs.map((s) => s.data.length)).toEqual([2, 1]);
    expect(secs[0].title.startsWith("Demain")).toBe(true);
    expect(timeOf(secs[0].data[1].at)).toBe("13:00");
  });
  it("statuts : libellés et annulations", () => {
    expect(isCancelled("CANCELLED_BY_PARTNER")).toBe(true);
    expect(isCancelled("COMPLETED")).toBe(false);
    expect(STATUS_LABEL.CANCELLED_BY_CLIENT).toBe("Annulée");
  });
  it("attente et compte à rebours", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    expect(waitedMin("2026-11-21T08:57:00Z", now)).toBe(63);
    expect(waitedMin(null, now)).toBe(0);
    expect(secondsUntil("2026-11-21T10:12:00Z", now)).toBe(720);
    expect(secondsUntil("2026-11-21T09:00:00Z", now)).toBe(0);
    expect(delayLabel(62)).toBe("+62 min");
    expect(delayLabel(0)).toBe("à l'heure");
  });
});

describe("flightLabel", () => {
  it("couvre retard, avance, posé, annulé et à l'heure", () => {
    expect(flightLabel({ status: "DELAYED", delayMin: 40 })).toEqual({ text: "retardé +40 min", tone: "warn" });
    expect(flightLabel({ status: "EARLY", delayMin: 0, earlyMin: 25 })).toEqual({ text: "en avance −25 min", tone: "ok" });
    expect(flightLabel({ status: "LANDED", delayMin: 0 }).text).toBe("posé");
    expect(flightLabel({ status: "CANCELLED", delayMin: 0 }).tone).toBe("bad");
    expect(flightLabel({ status: "SCHEDULED", delayMin: 0 }).text).toBe("à l'heure");
    expect(flightLabel({ status: "LANDED", delayMin: 30 }).text).toBe("posé"); // posé l'emporte sur un ancien retard
  });
});

describe("revenus (affichage)", () => {
  it("durées", () => {
    expect(hoursLabel(0)).toBe("0 min");
    expect(hoursLabel(0.5)).toBe("30 min");
    expect(hoursLabel(1.5)).toBe("1 h 30");
    expect(hoursLabel(2.0833)).toBe("2 h 05");
  });
  it("libellé de jour", () => {
    expect(dayLabel("2026-12-02")).toMatch(/02\/12/);
  });
});

describe("adresse du serveur", () => {
  it("accepte http(s)://hôte[:port] et retire l'éventuelle barre finale", () => {
    expect(normalizeApiUrl(" http://192.168.1.20:3000/ ")).toBe("http://192.168.1.20:3000");
    expect(normalizeApiUrl("https://api.exemple.fr")).toBe("https://api.exemple.fr");
  });
  it("refuse tout le reste", () => {
    for (const bad of ["", "192.168.1.20:3000", "ftp://x.fr", "http://x.fr/chemin", "http://a b.fr", "javascript:alert(1)"]) expect(normalizeApiUrl(bad)).toBeNull();
  });
});

describe("bourse d'échange", () => {
  const now = new Date("2026-06-01T10:00:00Z");
  it("ouverte avant la limite, fermée après ou une fois la mission commencée", () => {
    expect(swapState({ status: "ASSIGNED", swapDeadline: "2026-06-02T10:00:00Z" }, now)).toBe("open");
    expect(swapState({ status: "ASSIGNED", swapDeadline: "2026-06-02T10:00:00Z", swapOfferedAt: "2026-06-01T09:00:00Z" }, now)).toBe("offered");
    expect(swapState({ status: "ASSIGNED", swapDeadline: "2026-06-01T09:00:00Z" }, now)).toBe("closed");
    expect(swapState({ status: "EN_ROUTE", swapDeadline: "2026-06-02T10:00:00Z" }, now)).toBe("closed");
  });
});
