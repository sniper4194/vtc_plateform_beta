import {describe,expect,it} from "vitest";
import {appointmentSchema,draftSchema,emailAddress,permissionSchema,quoteText,renderTemplate,sendSchema,templateSchema} from "./crm-comms";
describe("CRM communications",()=>{
 it("normalise les adresses et exige une justification",()=>{expect(emailAddress.parse(" CONTACT@Example.fr ")).toBe("contact@example.fr");expect(permissionSchema.safeParse({allowed:true,reason:" "}).success).toBe(false);});
 it("exige une confirmation explicite",()=>{expect(sendSchema.safeParse({confirm:false}).success).toBe(false);expect(sendSchema.parse({confirm:true}).confirm).toBe(true);});
 it("valide le lien devis et empêche un objet multiligne",()=>{expect(draftSchema.safeParse({kind:"QUOTE",subject:"Devis",body:"Bonjour"}).success).toBe(false);expect(templateSchema.safeParse({name:"A",subject:"A\nB",body:"C"}).success).toBe(false);});
 it("personnalise sans interpréter le texte comme du code",()=>{expect(renderTemplate("Bonjour {{contact}} — {{company}}",{contact:"Mme X",company:"Hôtel"})).toBe("Bonjour Mme X — Hôtel");});
 it("refuse une fin antérieure au début",()=>{expect(appointmentSchema.safeParse({title:"RDV",startsAt:"2027-01-01T12:00:00Z",endsAt:"2027-01-01T11:00:00Z"}).success).toBe(false);});
 it("conserve les montants du devis",()=>{expect(quoteText({ref:1,issuerName:"A",issuerAddress:"B",issuerSiret:"123",recipientName:"C",recipientAddress:"D",description:"Transfert",quantity:2,unitCents:1000,vatBps:1000,priceMultiplier:1,terms:"Paiement",validUntil:new Date("2027-01-01")})).toContain("22,00 EUR");});
});
