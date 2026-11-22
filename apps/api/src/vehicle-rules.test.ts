import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVehicle } from "./vehicle-rules";

const good = { seats: 5, firstRegistrationYear: new Date().getFullYear() - 2, doors: 4, lengthMm: 4800, widthMm: 1850, powerKw: 110 };
beforeEach(() => { process.env.VEHICLE_RULES = "1"; });
afterEach(() => { process.env.VEHICLE_RULES = "0"; });

describe("critères d'admission du véhicule", () => {
  it("accepte un véhicule conforme", () => {
    expect(checkVehicle(good)).toEqual({ ok: true, problems: [] });
  });
  it("refuse chaque défaut avec un message précis", () => {
    const y = new Date().getFullYear();
    expect(checkVehicle({ ...good, seats: 3 }).problems[0]).toMatch(/places/);
    expect(checkVehicle({ ...good, seats: 10 }).problems[0]).toMatch(/places/);
    expect(checkVehicle({ ...good, firstRegistrationYear: y - 6 }).problems[0]).toMatch(/trop ancien/);
    expect(checkVehicle({ ...good, firstRegistrationYear: y - 5 }).ok).toBe(true);
    expect(checkVehicle({ ...good, doors: 2 }).problems[0]).toMatch(/Portes/);
    expect(checkVehicle({ ...good, lengthMm: 4400 }).problems[0]).toMatch(/Longueur/);
    expect(checkVehicle({ ...good, widthMm: 1650 }).problems[0]).toMatch(/Largeur/);
    expect(checkVehicle({ ...good, powerKw: 88 }).problems[0]).toMatch(/Puissance/); // strictement supérieure
    expect(checkVehicle({ ...good, powerKw: 89 }).ok).toBe(true);
  });
  it("une information absente est un défaut, jamais une présomption de conformité", () => {
    const r = checkVehicle({ seats: 5, firstRegistrationYear: null, doors: null, lengthMm: null, widthMm: null, powerKw: null });
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(5);
  });
  it("les seuils se règlent par l'environnement, le contrôle se désactive", () => {
    process.env.VEHICLE_MIN_LENGTH_MM = "4300";
    expect(checkVehicle({ ...good, lengthMm: 4400 }).ok).toBe(true);
    delete process.env.VEHICLE_MIN_LENGTH_MM;
    process.env.VEHICLE_RULES = "0";
    expect(checkVehicle({ seats: 1, firstRegistrationYear: null, doors: null, lengthMm: null, widthMm: null, powerKw: null }).ok).toBe(true);
  });
});
