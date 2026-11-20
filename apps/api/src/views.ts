import { Booking, Driver, Ride, Vehicle } from "@prisma/client";
import { euros } from "./http";

export type RideFull = Ride & { booking: Booking; driver: Driver | null; vehicle: Vehicle | null };

/** Vue partenaire d'une réservation (ne divulgue que l'utile : prénom, téléphone, véhicule). */
export function bookingView(r: RideFull) {
  return {
    id: r.booking.id,
    rideId: r.id,
    status: r.status,
    externalReference: r.booking.externalReference,
    category: r.category,
    pickupAt: r.pickupAt.toISOString(),
    pickup: { address: r.pickupAddress, lat: r.pickupLat, lng: r.pickupLng },
    dropoff: { address: r.dropoffAddress, lat: r.dropoffLat, lng: r.dropoffLng },
    flightNumber: r.booking.flightNumber,
    total: euros(r.priceCents),
    currency: "EUR",
    driver: r.driver
      ? {
          firstName: r.driver.firstName,
          phone: r.driver.phone,
          vehicle: r.vehicle ? `${r.vehicle.make} ${r.vehicle.model}` : null,
          plate: r.vehicle?.plate ?? null,
        }
      : null,
  };
}

export const WEBHOOK_BY_STATUS: Record<string, string | undefined> = {
  CONFIRMED: "booking.confirmed",
  ASSIGNED: "driver.assigned",
  EN_ROUTE: "driver.en_route",
  ARRIVED: "driver.arrived",
  IN_PROGRESS: "ride.started",
  COMPLETED: "ride.completed",
  CANCELLED_BY_CLIENT: "booking.cancelled",
  CANCELLED_BY_PARTNER: "booking.cancelled",
};
