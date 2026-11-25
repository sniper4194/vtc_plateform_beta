import { z } from "zod";
import { dayKeyTz } from "./metrics";

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s && s >= "2000-01-01" && s <= "2100-12-31";
}, "Date invalide").transform(s => new Date(s + "T00:00:00Z"));
export const todayParis = () => new Date(dayKeyTz(new Date()) + "T00:00:00Z");
const text = (max: number) => z.string().trim().min(1).max(max);
export const dealSchema = z.object({
  issuerName: text(160), issuerAddress: text(300), issuerSiret: z.string().trim().regex(/^\d{14}$/),
  recipientAddress: text(300), description: text(500),
  quantity: z.number().int().min(1).max(10000),
  unitCents: z.number().int().min(0).max(10000000),
  vatBps: z.number().int().min(0).max(10000),
  multiplierBps: z.number().int().min(1).max(50000),
  terms: text(1500), validUntil: dateOnly,
}).strict().refine(d => d.quantity * d.unitCents <= 1000000000, "Montant maximal : 10 millions EUR HT");
export const signatureSchema = z.object({
  contractRef: text(160), startsOn: dateOnly, endsOn: dateOnly, renewalOn: dateOnly,
}).strict().refine(d => d.startsOn <= d.renewalOn && d.renewalOn <= d.endsOn && d.startsOn < d.endsOn, "Dates du contrat incohérentes");
export const dealActionSchema = z.object({ action: z.enum(["SEND","ACCEPT","REJECT"]) }).strict();
export function totals(quantity: number, unitCents: number, vatBps: number) {
  const netCents = quantity * unitCents;
  const vatCents = Math.round(netCents * vatBps / 10000);
  return { netCents, vatCents, totalCents: netCents + vatCents };
}
export function nextStatus(status: string, action: string, valid: boolean) {
  if (status === "DRAFT" && action === "SEND" && valid) return "SENT" as const;
  if (status === "SENT" && action === "ACCEPT" && valid) return "ACCEPTED" as const;
  if (status === "SENT" && action === "REJECT") return "REJECTED" as const;
  return null;
}
