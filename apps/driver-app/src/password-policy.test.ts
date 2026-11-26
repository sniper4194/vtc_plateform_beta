import { describe, expect, it } from "vitest";
import { validNewPassword } from "./password-policy";
describe("Nouveaux mots de passe", () => {
  it.each(["Court1!", "longue phrase sans majuscule 1!", "LONGUE PHRASE SANS MINUSCULE 1!", "Une longue phrase sans chiffre!", "Une longue phrase sans symbole 1", " ".repeat(20)+"Aa1!", "Aa1!"+"x".repeat(125)])("refuse un mot de passe non conforme", p => expect(validNewPassword(p)).toBe(false));
  it.each(["Une longue phrase 7!", "Été et forêt avec A1@", "Aa1!"+"x".repeat(124)])("accepte un mot de passe conforme", p => expect(validNewPassword(p)).toBe(true));
});
