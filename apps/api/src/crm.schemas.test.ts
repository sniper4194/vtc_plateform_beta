import { describe, expect, it } from "vitest";
import { accountSchema, interactionSchema, listSchema } from "./crm.schemas";
const base = { name: "Hotel Démo", kind: "HOTEL", stage: "PROSPECT" };
describe("CRM", () => {
  it("accepte un prospect et rejette les champs inconnus", () => {
    expect(accountSchema.safeParse(base).success).toBe(true);
    expect(accountSchema.safeParse({ ...base, admin: true }).success).toBe(false);
    expect(accountSchema.safeParse({ ...base, stage: "INVALID" }).success).toBe(false);
  });
  it("valide les relances et contacts", () => {
    expect(accountSchema.safeParse({ ...base, nextAction: "Appeler" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...base, nextActionAt: "2026-11-25T12:00:00Z" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...base, nextAction: "Appeler", nextActionAt: "2026-11-25T12:00:00Z" }).success).toBe(true);
    expect(accountSchema.safeParse({ ...base, email: "invalid" }).success).toBe(false);
  });
  it("limite les notes et les filtres", () => {
    expect(interactionSchema.safeParse({ kind: "CALL", note: " " }).success).toBe(false);
    expect(interactionSchema.safeParse({ kind: "NOTE", note: "a".repeat(2001) }).success).toBe(false);
    expect(listSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(listSchema.parse({ page: "2" }).page).toBe(2);
  });
});
