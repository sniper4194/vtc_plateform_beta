import {describe,it,expect} from "vitest";
import {deadlines,canTransition,ticketSchema,moneySchema,ratingSchema,decisionSchema} from "./support";
describe("SAV",()=>{
it("fixe les objectifs en heures calendaires",()=>{const n=new Date("2026-11-25T12:00:00Z");expect(deadlines("URGENT",n).firstResponseDueAt.toISOString()).toBe("2026-11-25T12:30:00.000Z");expect(deadlines("NORMAL",n).resolutionDueAt.toISOString()).toBe("2026-11-28T12:00:00.000Z");});
it("impose le cycle de traitement",()=>{expect(canTransition("OPEN","CLOSED")).toBe(false);expect(canTransition("OPEN","IN_PROGRESS")).toBe(true);expect(canTransition("WAITING","RESOLVED")).toBe(true);expect(canTransition("CLOSED","OPEN")).toBe(false);});
it("valide la demande financière et la décision",()=>{expect(moneySchema.safeParse({version:0,kind:"REFUND",amountCents:0,reason:"Motif"}).success).toBe(false);expect(moneySchema.safeParse({version:0,kind:"REFUND",amountCents:1000001,reason:"Motif"}).success).toBe(false);expect(decisionSchema.safeParse({version:0,decision:"PAID",reason:"Motif"}).success).toBe(false);});
it("valide ticket et satisfaction",()=>{const t={title:"Retard",description:"Faits",source:"CLIENT",category:"DELAY",priority:"NORMAL"};expect(ticketSchema.safeParse(t).success).toBe(true);expect(ticketSchema.safeParse({...t,status:"CLOSED"}).success).toBe(false);expect(ratingSchema.safeParse({version:0,score:6,note:"Avis"}).success).toBe(false);});
});
