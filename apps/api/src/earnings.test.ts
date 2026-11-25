import { describe, expect, it } from "vitest";
import { aggregate, dayKey, earningsCsv, missionMinutes, periodBounds } from "./earnings";

const D = (s: string) => new Date(s);
describe("revenus : périodes à l'heure de Paris", () => {
  it("jour, semaine, quinzaine, mois (hiver)", () => {
    const now = D("2026-12-02T10:00:00Z"); // mercredi 2 décembre, 11 h à Paris
    expect(periodBounds("day", now)).toEqual({ from: D("2026-12-01T23:00:00Z"), to: D("2026-12-02T23:00:00Z") });
    expect(periodBounds("week", now).from).toEqual(D("2026-11-29T23:00:00Z")); // lundi 30/11 à 00 h Paris
    expect(periodBounds("week", now).to).toEqual(D("2026-12-06T23:00:00Z"));
    expect(periodBounds("fortnight", now)).toEqual({ from: D("2026-11-30T23:00:00Z"), to: D("2026-12-15T23:00:00Z") });
    expect(periodBounds("fortnight", D("2026-12-20T10:00:00Z")).from).toEqual(D("2026-12-15T23:00:00Z"));
    expect(periodBounds("month", now)).toEqual({ from: D("2026-11-30T23:00:00Z"), to: D("2026-12-31T23:00:00Z") });
  });
  it("heure d'été : minuit Paris = 22 h UTC", () => {
    expect(periodBounds("day", D("2026-07-15T12:00:00Z")).from).toEqual(D("2026-07-14T22:00:00Z"));
  });
  it("une course à 23 h 30 UTC appartient au jour suivant à Paris", () => {
    expect(dayKey(D("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
  });
});

describe("revenus : agrégation", () => {
  const ride = (n: number, at: string, net: number, min: number) => ({ rideId: `r${n}`, ref: 100000 + n, at: D(at), route: "CDG → Paris", netCents: net, clientCents: null, commissionCents: null, missionMin: min });
  it("net = courses + indemnités − pénalités ; net par heure avant pénalités", () => {
    const e = aggregate(
      [ride(1, "2026-12-02T08:00:00Z", 4400, 60), ride(2, "2026-12-02T12:00:00Z", 3600, 30)],
      [{ rideId: "r3", ref: 100003, at: D("2026-12-03T09:00:00Z"), cents: 2200 }],
      [{ id: "p1", ref: 100004, at: D("2026-12-03T10:00:00Z"), cents: 1000, kind: "GIVE_BACK" }],
    );
    expect(e.totals.ridesCents).toBe(8000);
    expect(e.totals.compensationCents).toBe(2200);
    expect(e.totals.penaltyCents).toBe(1000);
    expect(e.totals.netCents).toBe(9200);
    expect(e.totals.missionHours).toBe(1.5);
    expect(e.totals.netPerMissionHourCents).toBe(6800); // (8000 + 2200) / 1,5 h
    expect(e.totals.avgPerRideCents).toBe(4000);
    expect(e.days).toEqual([{ day: "2026-12-02", rides: 2, cents: 8000 }, { day: "2026-12-03", rides: 0, cents: 1200 }]);
    expect(e.rides[0].ref).toBe(100002); // plus récent d'abord
  });
  it("période vide : pas de division par zéro", () => {
    const e = aggregate([], [], []);
    expect(e.totals.netPerMissionHourCents).toBeNull();
    expect(e.totals.avgPerRideCents).toBeNull();
    expect(e.totals.netCents).toBe(0);
  });
  it("durée de mission : événements, sinon durée estimée, plafonnée", () => {
    expect(missionMinutes(D("2026-12-02T08:00:00Z"), D("2026-12-02T09:15:00Z"), 40)).toBe(75);
    expect(missionMinutes(null, null, 40)).toBe(40);
    expect(missionMinutes(D("2026-12-02T08:00:00Z"), D("2026-12-02T08:00:01Z"), 40)).toBe(40); // « terminer » enchaîné : mesure non crédible, durée estimée
    expect(missionMinutes(D("2026-12-02T08:00:00Z"), D("2026-12-04T08:00:00Z"), 40)).toBe(720); // course jamais clôturée
  });
  it("CSV lisible dans un tableur français", () => {
    const e = aggregate([ride(1, "2026-12-02T08:00:00Z", 4400, 60)], [], [{ id: "p", ref: 100009, at: D("2026-12-02T09:00:00Z"), cents: 1000, kind: "RESCUE" }]);
    const csv = earningsCsv(e);
    expect(csv.split("\n")[0]).toBe("type;date;reference;detail;montant_eur");
    expect(csv).toContain('COURSE;2026-12-02;R-100001;"CDG → Paris";44,00');
    expect(csv).toContain("PENALITE;2026-12-02;R-100009;\"Appel de sauveteur\";-10,00");
    expect(csv).toContain('TOTAL;;;"Net de la période";34,00');
  });
});
