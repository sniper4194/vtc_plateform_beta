import { describe, expect, it } from "vitest";
import { newLandings } from "./landing";

const at = (min: number) => new Date(Date.UTC(2026, 10, 24, 12, min)).toISOString();
const start = Date.UTC(2026, 10, 24, 12, 10);

describe("alerte d'atterrissage", () => {
  it("ne sonne que les atterrissages nouveaux, arrivés depuis le lancement", () => {
    const items = [
      { id: "a", type: "FLIGHT_LANDED", title: "Vol AF1234 atterri", createdAt: at(15) },
      { id: "b", type: "FLIGHT_DELAYED", title: "Vol AF1234 retardé", createdAt: at(14) },
      { id: "c", type: "FLIGHT_LANDED", title: "Vol BA304 atterri", createdAt: at(5) }, // avant le lancement
    ];
    expect(newLandings(items, new Set(), start).map((n) => n.id)).toEqual(["a"]);
  });
  it("ne sonne jamais deux fois le même message", () => {
    const items = [{ id: "a", type: "FLIGHT_LANDED", title: "x", createdAt: at(15) }];
    expect(newLandings(items, new Set(["a"]), start)).toEqual([]);
  });
});
