import { describe, expect, it } from "vitest";
import { emptyForm, toPayload, validate, type Form } from "./application";

const ok: Form = { ...emptyForm, firstName: "Karim", lastName: "Benali", phone: "06 12 34 56 78", email: "k@test.fr", years: "6", code: "CLI-ABCD-EFGH", consent: true };

describe("formulaire de candidature", () => {
  it("accepte un dossier complet", () => { expect(validate(ok)).toEqual({}); });
  it("signale chaque champ manquant, dont le code de parrainage et le consentement", () => {
    const e = validate(emptyForm);
    expect(Object.keys(e).sort()).toEqual(["code", "consent", "email", "firstName", "lastName", "phone", "years"]);
  });
  it("exige un nom de plateforme avec une note comprise entre 0 et 5", () => {
    expect(validate({ ...ok, platforms: [{ name: "X", rating: "4,8" }] })).toEqual({});
    expect(validate({ ...ok, platforms: [{ name: "X", rating: "6" }] }).platforms).toBeDefined();
    expect(validate({ ...ok, platforms: [{ name: "", rating: "4" }] }).platforms).toBeDefined();
    expect(validate({ ...ok, platforms: [{ name: "", rating: "" }] })).toEqual({}); // ligne vide : ignorée
  });
  it("prépare le corps de la requête", () => {
    expect(toPayload({ ...ok, platforms: [{ name: " Y ", rating: "4,5" }, { name: "", rating: "" }] })).toEqual({
      firstName: "Karim", lastName: "Benali", phone: "06 12 34 56 78", email: "k@test.fr", yearsExperience: 6,
      otherPlatforms: [{ name: "Y", rating: 4.5 }], referralCode: "CLI-ABCD-EFGH", consent: true,
    });
  });
});
