import { VEHICLE_NEEDS } from "@vtc/shared";
import { z } from "zod";
import { normalizePhone } from "./phone";

export const DriverOtpRequestSchema = z.object({ phone: z.string().min(6).max(30) });
export const DriverLoginSchema = z.object({ phone: z.string().min(6).max(30), code: z.string().min(4).max(10) });
/** Numéro normalisé en E.164 (06 12… → +33612…). */
export const phoneField = z.string().min(6).max(30).transform((v, ctx) => { const n = normalizePhone(v); if (!n) ctx.addIssue({ code: "custom", message: "numéro invalide" }); return n ?? v; });
export const AvailabilitySchema = z.object({ availability: z.enum(["AVAILABLE", "SUSPENDED"]) });
export const LocationUpdateSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const DocumentUploadSchema = z.object({
  type: z.enum(["VTC_CARD", "DRIVING_LICENSE", "KBIS", "INSURANCE", "REGISTRATION_CERT", "TECHNICAL_INSPECTION", "AIRPORT_BADGE", "ID"]),
  storageKey: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});
/** Gammes CliCab : Hôtel (hôtels, restaurants), Dépannage (garages, assurances), Association, Care (établissements de santé). */
export const PARTNER_RANGES = ["HOTEL", "DEPANNAGE", "ASSOCIATION", "CARE"] as const;
export const PartnerCreateSchema = z.object({
  name: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  priceMultiplier: z.number().positive().max(5).default(1),
  commissionRate: z.number().min(0).max(0.9).default(0.2),
  paymentMode: z.enum(["PREPAID", "INVOICE"]).default("INVOICE"),
  notifyPassenger: z.boolean().default(true),
  range: z.enum(PARTNER_RANGES).nullable().optional(),
});
/** Caractéristiques contrôlées à l'admission du véhicule (voir vehicle-rules.ts). */
const vehicleFacts = {
  collector: z.boolean().optional(),
  firstRegistrationAt: z.coerce.date().min(new Date("1990-01-01")).max(new Date(Date.now() + 86400_000)).optional(),
  fuel: z.enum(["THERMAL", "HYBRID", "ELECTRIC"]).optional(),
  doors: z.number().int().min(1).max(9).optional(),
  lengthMm: z.number().int().min(1000).max(8000).optional(),
  widthMm: z.number().int().min(1000).max(3000).optional(),
  powerKw: z.number().min(10).max(1000).optional(),
  /** Équipements pour les besoins particuliers (siège enfant, rehausseur, fauteuil roulant, animal). */
  features: z.array(z.enum(VEHICLE_NEEDS)).max(VEHICLE_NEEDS.length).optional(),
};
export const DriverCreateSchema = z.object({
  businessName: z.string().min(1).max(200).optional(), siret: z.string().regex(/^(\d{9}|\d{14})$/).optional(),
  revtcNumber: z.string().min(3).max(40).optional(), proCardNumber: z.string().min(3).max(40).optional(),
  firstName: z.string().min(1), lastName: z.string().min(1),
  phone: phoneField, email: z.string().email(),
  vehicle: z.object({
    plate: z.string().min(4), make: z.string(), model: z.string(),
    category: z.enum(["BERLINE", "BUSINESS", "VAN", "GREEN"]), seats: z.number().int().min(1).max(9).default(4),
    ...vehicleFacts,
  }).optional(),
});
export const VehicleCreateSchema = z.object({
  plate: z.string().min(4), make: z.string().min(1), model: z.string().min(1),
  category: z.enum(["BERLINE", "BUSINESS", "VAN", "GREEN"]), seats: z.number().int().min(1).max(9).default(4),
  ...vehicleFacts,
  driverId: z.string().uuid().optional(),
});
export const CompanyCreateSchema = z.object({ name: z.string().min(1), siret: z.string().regex(/^\d{14}$/).optional(), vtcRegistry: z.string().optional() });
export const FlightUpdateSchema = z.object({
  estimatedArrivalAt: z.string().datetime().nullable().optional(),
  status: z.enum(["SCHEDULED", "DELAYED", "EARLY", "LANDED", "CANCELLED"]).optional(),
});
export const RatingSchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional() });
export const AdminUserCreateSchema = z.object({
  email: z.string().email().max(200), name: z.string().min(1).max(100),
  role: z.enum(["ADMIN", "DISPATCHER"]).default("DISPATCHER"), password: z.string().min(1).max(200),
});
export const PasswordResetSchema = z.object({ password: z.string().min(1).max(200) });
export const ReviewSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });
export const AssignSchema = z.object({
  driverId: z.string().uuid(),
  priceCents: z.number().int().min(0).max(1_000_000),
  verbalConsentConfirmed: z.literal(true),
});
