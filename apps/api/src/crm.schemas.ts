import { z } from "zod";

export const stages = ["PROSPECT", "CONTACTED", "OFFER", "NEGOTIATION", "WON", "LOST"] as const;
export const kinds = ["HOTEL", "COMPANY", "AGENCY", "CONCIERGE", "OTHER"] as const;
export const interactionKinds = ["CALL", "EMAIL", "MEETING", "NOTE"] as const;
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
export const accountSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(kinds),
  stage: z.enum(stages),
  contactName: nullableText(120),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: nullableText(40),
  nextAction: nullableText(500),
  nextActionAt: z.string().datetime({ offset: true }).transform(s => new Date(s)).nullable().optional(),
  partnerId: z.string().uuid().nullable().optional(),
}).strict().refine(v => Boolean(v.nextAction) === Boolean(v.nextActionAt), "Indiquez ensemble l'action et sa date.");
export const interactionSchema = z.object({
  kind: z.enum(interactionKinds),
  note: z.string().trim().min(1).max(2000),
}).strict();
export const listSchema = z.object({
  q: z.string().trim().max(160).default(""),
  stage: z.enum(stages).optional(),
  overdue: z.enum(["1", "0"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();

export const activitySchema = z.object({ days: z.enum(["30", "90", "365"]).default("30") }).strict();
export const completeFollowUpSchema = z.object({
  action: z.string().trim().min(1).max(500),
  at: z.string().datetime({ offset: true }).transform(s => new Date(s)),
}).strict();
