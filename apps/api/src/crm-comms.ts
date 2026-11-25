import { z } from "zod";
import { totals } from "./crm-deals";
const text = (max:number) => z.string().trim().min(1).max(max);
const subject = text(180).refine(s => !/[\r\n]/.test(s), "Objet sur une ligne");
export const emailAddress = z.string().trim().email().max(200).transform(s => s.toLowerCase());
export const permissionSchema = z.object({ allowed:z.boolean(), reason:text(500) }).strict();
export const templateSchema = z.object({ name:text(100), subject, body:text(4000) }).strict();
export const draftSchema = z.object({ kind:z.enum(["PROSPECTING","FOLLOW_UP","QUOTE","RENEWAL"]), subject, body:text(4000), dealId:z.string().uuid().optional() }).strict().refine(v => (v.kind==="QUOTE") === Boolean(v.dealId), "Associer un devis uniquement pour un envoi de devis");
export const sendSchema = z.object({ confirm:z.literal(true) }).strict();
const instant = z.string().datetime({offset:true}).transform(s => new Date(s));
export const appointmentSchema = z.object({ title:text(160), startsAt:instant, endsAt:instant, location:text(300).optional() }).strict().refine(v => v.endsAt > v.startsAt && v.endsAt.getTime()-v.startsAt.getTime()<=86400_000, "Durée invalide");
export function renderTemplate(s:string, vars:{company:string;contact:string}) {
  return s.replace(/\{\{(company|contact)\}\}/g, (_,key:"company"|"contact") => vars[key]);
}
export function quoteText(d:{ref:number;issuerName:string;issuerAddress:string;issuerSiret:string;recipientName:string;recipientAddress:string;description:string;quantity:number;unitCents:number;vatBps:number;priceMultiplier:unknown;terms:string;validUntil:Date}) {
  const t=totals(d.quantity,d.unitCents,d.vatBps);
  const eur=(n:number)=>(n/100).toFixed(2).replace(".",",")+" EUR";
  return ["Devis DEV-"+String(d.ref).padStart(6,"0"),"Émetteur : "+d.issuerName+" / "+d.issuerAddress+" / SIRET "+d.issuerSiret,"Client : "+d.recipientName+" / "+d.recipientAddress,"Prestation : "+d.description,"Quantité : "+d.quantity+" ; prix unitaire HT : "+eur(d.unitCents),"Total HT : "+eur(t.netCents)+" ; TVA ("+d.vatBps/100+" %) : "+eur(t.vatCents)+" ; TTC : "+eur(t.totalCents),"Coefficient tarif partenaire : "+String(d.priceMultiplier),"Validité : "+d.validUntil.toISOString().slice(0,10),"Conditions : "+d.terms,"Document commercial, non facture."].join("\n");
}
