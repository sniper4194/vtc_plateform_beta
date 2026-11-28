import { afterEach, describe, expect, it } from "vitest";
import { asapLeadMin, DETAILS_SCHEMA, driverInstructions, rangeFeatures, rangeOf } from "./partner-ranges";

describe("gammes : champs et consignes", () => {
  afterEach(() => { delete process.env.ASAP_LEAD_MIN; });
  it("fonctions de l'écran selon la gamme", () => {
    expect(rangeFeatures(null).room).toBe(true);
    expect(rangeFeatures("DEPANNAGE")).toMatchObject({ caseNumber: true, asap: true, returnTrip: false, room: false });
    expect(rangeFeatures("CARE")).toMatchObject({ returnTrip: true, department: true, escorts: true, walkingAssist: true, asap: false });
    expect(rangeOf("TAXI")).toBeNull();
  });
  it("refuse les champs d'une autre gamme", () => {
    expect(DETAILS_SCHEMA.DEPANNAGE.safeParse({ caseNumber: "SIN-42", brokenPlate: "ab-123-cd" }).data).toEqual({ caseNumber: "SIN-42", brokenPlate: "AB-123-CD" });
    expect(DETAILS_SCHEMA.DEPANNAGE.safeParse({ department: "Radiologie" }).success).toBe(false);
    expect(DETAILS_SCHEMA.CARE.safeParse({ escorts: 5 }).success).toBe(false);
  });
  it("consignes au chauffeur", () => {
    expect(driverInstructions("DEPANNAGE", { caseNumber: "SIN-42", brokenPlate: "AB-123-CD", asap: true })).toEqual([
      "Urgence : le client attend, partez dès que possible", "Dossier n° SIN-42", "Véhicule en panne : AB-123-CD",
    ]);
    const care = driverInstructions("CARE", { department: "Cardiologie, 3e étage", escorts: 1, walkingAssist: true, leg: "RETOUR" });
    expect(care[0]).toBe("Trajet retour d'un aller-retour");
    expect(care).toContain("1 accompagnant à bord");
    expect(care).toContain("Aider le passager à marcher jusqu'à la porte");
    expect(driverInstructions("HOTEL", null)).toEqual([]);
  });
  it("délai « dès que possible » réglable, 5 min au moins", () => {
    expect(asapLeadMin()).toBe(20);
    process.env.ASAP_LEAD_MIN = "2"; expect(asapLeadMin()).toBe(5);
  });
});
