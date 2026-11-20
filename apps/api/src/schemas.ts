import { z } from "zod";

export const DriverLoginSchema = z.object({ phone: z.string().min(6), code: z.string().min(4) });
export const AvailabilitySchema = z.object({ availability: z.enum(["AVAILABLE", "SUSPENDED"]) });
export const LocationUpdateSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const DocumentUploadSchema = z.object({
  type: z.enum(["VTC_CARD", "DRIVING_LICENSE", "KBIS", "INSURANCE", "REGISTRATION_CERT", "TECHNICAL_INSPECTION", "ID"]),
  storageKey: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});
export const PartnerCreateSchema = z.object({
  name: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  priceMultiplier: z.number().positive().max(5).default(1),
  commissionRate: z.number().min(0).max(0.9).default(0.2),
  paymentMode: z.enum(["PREPAID", "INVOICE"]).default("INVOICE"),
});
export const DriverCreateSchema = z.object({
  firstName: z.string().min(1), lastName: z.string().min(1),
  phone: z.string().min(6), email: z.string().email(),
  vehicle: z.object({
    plate: z.string().min(4), make: z.string(), model: z.string(),
    category: z.enum(["BERLINE", "BUSINESS", "VAN", "GREEN"]), seats: z.number().int().min(1).default(4),
  }).optional(),
});
export const VehicleCreateSchema = z.object({
  plate: z.string().min(4), make: z.string().min(1), model: z.string().min(1),
  category: z.enum(["BERLINE", "BUSINESS", "VAN", "GREEN"]), seats: z.number().int().min(1).max(9).default(4),
  driverId: z.string().uuid().optional(),
});
export const CompanyCreateSchema = z.object({ name: z.string().min(1), siret: z.string().regex(/^\d{14}$/).optional(), vtcRegistry: z.string().optional() });
export const FlightUpdateSchema = z.object({
  estimatedArrivalAt: z.string().datetime().nullable().optional(),
  status: z.enum(["SCHEDULED", "DELAYED", "LANDED", "CANCELLED"]).optional(),
});
export const RatingSchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional() });
export const ReviewSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });
export const AssignSchema = z.object({ driverId: z.string().uuid() });
