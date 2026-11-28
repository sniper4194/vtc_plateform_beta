import { describe, expect, it } from "vitest";
import { ON_BOARD_ISSUE_LABEL, paymentBody } from "./onBoardPaymentBody";

describe("réponse d'encaissement à bord", () => {
  it("paiement encaissé", () => {
    expect(paymentBody({ status: "PAID" })).toEqual({ payment: { status: "PAID" } });
  });
  it("problème : motif, note seulement si remplie", () => {
    expect(paymentBody({ status: "ISSUE", reason: "DECLINED", note: "  " })).toEqual({ payment: { status: "ISSUE", reason: "DECLINED" } });
    expect(paymentBody({ status: "ISSUE", reason: "OTHER", note: " client parti " })).toEqual({ payment: { status: "ISSUE", reason: "OTHER", note: "client parti" } });
  });
  it("mêmes motifs que l'API", () => {
    expect(Object.keys(ON_BOARD_ISSUE_LABEL)).toEqual(["DECLINED", "REFUSED", "TERMINAL", "OTHER"]);
  });
});
