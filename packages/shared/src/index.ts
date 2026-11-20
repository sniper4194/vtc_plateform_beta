import { z } from "zod";

export const VehicleCategorySchema = z.enum(["BERLINE", "BUSINESS", "VAN", "GREEN"]);

export const RideStatusSchema = z.enum([
  "CREATED", "QUOTED", "CONFIRMED", "DISPATCHING", "ASSIGNED", "EN_ROUTE",
  "ARRIVED", "IN_PROGRESS", "COMPLETED",
  "CANCELLED_BY_CLIENT", "CANCELLED_BY_PARTNER", "NO_SHOW", "DISPUTED", "REFUNDED",
]);
export type RideStatus = z.infer<typeof RideStatusSchema>;

/** Transitions autorisées de la machine à états d'une course. */
export const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  CREATED: ["QUOTED", "CONFIRMED", "CANCELLED_BY_CLIENT"],
  QUOTED: ["CONFIRMED", "CANCELLED_BY_CLIENT"],
  CONFIRMED: ["DISPATCHING", "CANCELLED_BY_CLIENT", "CANCELLED_BY_PARTNER"],
  DISPATCHING: ["ASSIGNED", "CANCELLED_BY_CLIENT", "CANCELLED_BY_PARTNER"],
  // annulation chauffeur => retour en DISPATCHING
  ASSIGNED: ["EN_ROUTE", "DISPATCHING", "CANCELLED_BY_CLIENT", "CANCELLED_BY_PARTNER"],
  EN_ROUTE: ["ARRIVED", "DISPATCHING", "CANCELLED_BY_CLIENT", "CANCELLED_BY_PARTNER"],
  ARRIVED: ["IN_PROGRESS", "NO_SHOW", "CANCELLED_BY_CLIENT"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  CANCELLED_BY_CLIENT: ["REFUNDED"],
  CANCELLED_BY_PARTNER: ["REFUNDED"],
  NO_SHOW: ["DISPUTED"],
  DISPUTED: ["REFUNDED", "COMPLETED"],
  REFUNDED: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from].includes(to);
}

export const LocationSchema = z.object({
  address: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const QuoteRequestSchema = z.object({
  pickup: LocationSchema,
  dropoff: LocationSchema,
  pickupAt: z.string().datetime(),
  category: VehicleCategorySchema,
  passengers: z.number().int().min(1).max(8),
  luggage: z.number().int().min(0).max(12).default(0),
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/).optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const BookingRequestSchema = z.object({
  quoteId: z.string().uuid(),
  externalReference: z.string().max(100).optional(),
  /** Texte de la pancarte d'accueil (par défaut : nom du passager). */
  signText: z.string().max(100).optional(),
  /** Consignes de rendez-vous (terminal, porte, étage…). */
  notes: z.string().max(500).optional(),
  passenger: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().min(6),
    email: z.string().email().optional(),
    language: z.string().length(2).default("fr"),
  }),
});
export type BookingRequest = z.infer<typeof BookingRequestSchema>;

export const WEBHOOK_EVENTS = [
  "booking.confirmed", "driver.assigned", "driver.en_route", "driver.arrived",
  "ride.started", "ride.completed", "booking.cancelled", "flight.delayed",
] as const;
