import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVehicle } from "./vehicle-rules";

const ago = (years: number, extraDays = 0) => { const d = new Date(); d.setFullYear(d.getFullYear() - years); d.setDate(d.getDate() + extraDays); return d; };
const good = { seats: 5, fuel: "THERMAL" as const, firstRegistrationAt: ago(2), doors: 4, lengthMm: 4800, widthMm: 1850, powerKw: 110 };
beforeEach(() => { process.env.VEHICLE_RULES = "1"; });
afterEach(() => { process.env.VEHICLE_RULES = "0"; });

describe("critères d'admission du véhicule", () => {
  it("accepte un véhicule conforme", () => {
    expect(checkVehicle(good)).toEqual({ ok: true, problems: [] });
  });
  it("refuse chaque défaut avec un message précis", () => {
    expect(checkVehicle({ ...good, seats: 3 }).problems[0]).toMatch(/places/);
    expect(checkVehicle({ ...good, seats: 10 }).problems[0]).toMatch(/places/);
    expect(checkVehicle({ ...good, firstRegistrationAt: ago(7, -1) }).problems[0]).toMatch(/trop ancien/); // 7 ans révolus
    expect(checkVehicle({ ...good, firstRegistrationAt: ago(7, 30) }).ok).toBe(true); // 6 ans et 11 mois : encore admis
    expect(checkVehicle({ ...good, doors: 2 }).problems[0]).toMatch(/Portes/);
    expect(checkVehicle({ ...good, lengthMm: 4400 }).problems[0]).toMatch(/Longueur/);
    expect(checkVehicle({ ...good, widthMm: 1650 }).problems[0]).toMatch(/Largeur/);
    expect(checkVehicle({ ...good, powerKw: 83 }).problems[0]).toMatch(/Puissance/);
    expect(checkVehicle({ ...good, powerKw: 84 }).ok).toBe(true); // « au moins 84 kW »
  });
  it("une information absente est un défaut, jamais une présomption de conformité", () => {
    const r = checkVehicle({ seats: 5, fuel: null, firstRegistrationAt: null, doors: null, lengthMm: null, widthMm: null, powerKw: null });
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThanOrEqual(6);
  });
  it("hybrides et électriques : exemptés d'âge, de puissance et de dimensions, pas de places ni de portes", () => {
    const old = { seats: 5, doors: 4, firstRegistrationAt: ago(9), lengthMm: 4100, widthMm: 1650, powerKw: 60 };
    expect(checkVehicle({ ...old, fuel: "HYBRID" }).ok).toBe(true); // ex. Yaris hybride de 9 ans
    expect(checkVehicle({ ...old, fuel: "ELECTRIC" }).ok).toBe(true);
    expect(checkVehicle({ ...old, fuel: "THERMAL" }).ok).toBe(false);
    expect(checkVehicle({ ...old, fuel: "HYBRID", doors: 2 }).ok).toBe(false);
    expect(checkVehicle({ ...old, fuel: "ELECTRIC", seats: 3 }).ok).toBe(false);
    expect(checkVehicle({ seats: 5, doors: 4, fuel: null, firstRegistrationAt: ago(1), lengthMm: 4800, widthMm: 1850, powerKw: 110 }).ok).toBe(false); // motorisation inconnue
  });
  it("les seuils se règlent par l'environnement, le contrôle se désactive", () => {
    process.env.VEHICLE_MIN_LENGTH_MM = "4300";
    expect(checkVehicle({ ...good, lengthMm: 4400 }).ok).toBe(true);
    delete process.env.VEHICLE_MIN_LENGTH_MM;
    process.env.VEHICLE_RULES = "0";
    expect(checkVehicle({ seats: 1, fuel: null, firstRegistrationAt: null, doors: null, lengthMm: null, widthMm: null, powerKw: null }).ok).toBe(true);
  });
});
