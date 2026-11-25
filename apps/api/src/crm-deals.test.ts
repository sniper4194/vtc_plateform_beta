import { describe, expect, it } from "vitest";
import { dateOnly, totals, nextStatus, signatureSchema, dealSchema } from "./crm-deals";
describe("CRM devis",()=>{
 it("calcule en centimes et arrondit la TVA",()=>{expect(totals(3,1999,2000)).toEqual({netCents:5997,vatCents:1199,totalCents:7196});});
 it("rejette dates impossibles et contrats incohérents",()=>{expect(dateOnly.safeParse("2026-02-30").success).toBe(false);expect(signatureSchema.safeParse({contractRef:"C",startsOn:"2026-12-01",endsOn:"2027-12-01",renewalOn:"2028-01-01"}).success).toBe(false);});
 it("impose les transitions et la validité",()=>{expect(nextStatus("DRAFT","ACCEPT",true)).toBeNull();expect(nextStatus("DRAFT","SEND",false)).toBeNull();expect(nextStatus("SENT","ACCEPT",true)).toBe("ACCEPTED");expect(nextStatus("SIGNED","REJECT",true)).toBeNull();});
 it("impose les coordonnées et des montants bornés",()=>{const d={issuerName:"Test",issuerAddress:"Adresse",issuerSiret:"12345678901234",recipientAddress:"Adresse",description:"Course",quantity:2,unitCents:1000,vatBps:1000,multiplierBps:9000,terms:"Paiement",validUntil:"2027-01-01"};expect(dealSchema.safeParse(d).success).toBe(true);expect(dealSchema.safeParse({...d,issuerSiret:"123"}).success).toBe(false);expect(dealSchema.safeParse({...d,quantity:10000,unitCents:10000000}).success).toBe(false);});
});
