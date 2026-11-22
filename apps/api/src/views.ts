import { Booking, Driver, Ride, Vehicle } from "@prisma/client";
import { euros } from "./http";
import { effectivePickup, NO_SHOW_WAIT_MIN } from "./metrics";

export type RideFull = Ride & { booking: Booking; driver: Driver | null; vehicle: Vehicle | null };

/** Vue partenaire d'une réservation (ne divulgue que l'utile : prénom, téléphone, véhicule). */
export function bookingView(r: RideFull) {
  return {
    id: r.booking.id,
    rideId: r.id,
    ref: r.ref,
    reference: `R-${r.ref}`,
    status: r.status,
    externalReference: r.booking.externalReference,
    category: r.category,
    pickupAt: r.pickupAt.toISOString(),
    effectivePickupAt: effectivePickup(r.pickupAt, r.flightDelayMin).toISOString(),
    signText: r.booking.signText ?? `${r.booking.passengerFirstName} ${r.booking.passengerLastName}`,
    notes: r.booking.notes,
    flight: r.booking.flightNumber
      ? {
          number: r.booking.flightNumber,
          status: r.flightStatus ?? "SCHEDULED",
          delayMin: r.flightDelayMin,
          earlyMin: r.flightEarlyMin,
          estimatedArrivalAt: r.flightEstimatedAt?.toISOString() ?? null,
          bufferMin: r.flightBufferMin,
          scheduledArrivalAt: new Date(r.pickupAt.getTime() - r.flightBufferMin * 60_000).toISOString(),
        }
      : null,
    pickup: { address: r.pickupAddress, lat: r.pickupLat, lng: r.pickupLng },
    dropoff: { address: r.dropoffAddress, lat: r.dropoffLat, lng: r.dropoffLng },
    flightNumber: r.booking.flightNumber,
    total: euros(r.priceCents),
    currency: "EUR",
    // Lien de suivi à transmettre au voyageur (page publique, sans compte) ; null pour les anciennes réservations.
    trackingUrl: r.booking.trackingToken ? `${(process.env.TRACKING_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "")}/suivi/${r.booking.trackingToken}` : null,
    driver: r.driver
      ? {
          firstName: r.driver.firstName,
          phone: r.driver.phone,
          vehicle: r.vehicle ? `${r.vehicle.make} ${r.vehicle.model}` : null,
          plate: r.vehicle?.plate ?? null,
          // Photo du chauffeur, seulement s'il y a consenti, montrée au voyageur pendant sa course (GET avec la clé du partenaire ; 404 tant qu'aucune photo n'est validée).
          photoUrl: r.driver.photoConsentAt ? `/v1/bookings/${r.booking.id}/driver-photo` : null,
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

/** Vue chauffeur d'une mission attribuée (passager, pancarte, vol, attente). */
export function driverRideView(r: RideFull & { booking: Booking & { partner?: { name: string } | null } }, arrivedAt: Date | null) {
  const eff = effectivePickup(r.pickupAt, r.flightDelayMin);
  const name = `${r.booking.passengerFirstName} ${r.booking.passengerLastName}`;
  return {
    rideId: r.id, ref: r.ref, reference: `R-${r.ref}`, status: r.status, category: r.category,
    pickupAt: r.pickupAt, effectivePickupAt: eff,
    compensationCents: r.driverCompensationCents,
    rideType: r.flatRateId ? "FORFAIT" : "COMPTEUR",
    partner: r.booking.partner?.name ?? null,
    pickup: { address: r.pickupAddress, lat: r.pickupLat, lng: r.pickupLng },
    dropoff: { address: r.dropoffAddress, lat: r.dropoffLat, lng: r.dropoffLng },
    passenger: { name, phone: r.booking.passengerPhone, language: r.booking.passengerLanguage },
    signText: r.booking.signText ?? name,
    notes: r.booking.notes,
    flight: r.booking.flightNumber
      ? {
          number: r.booking.flightNumber, status: r.flightStatus ?? "SCHEDULED", delayMin: r.flightDelayMin, earlyMin: r.flightEarlyMin, estimatedArrivalAt: r.flightEstimatedAt,
          bufferMin: r.flightBufferMin, scheduledArrivalAt: new Date(r.pickupAt.getTime() - r.flightBufferMin * 60_000),
        }
      : null,
    passengers: r.passengers, luggage: r.luggage, netCents: r.driverNetCents,
    vehicle: r.vehicle ? { plate: r.vehicle.plate, model: `${r.vehicle.make} ${r.vehicle.model}` } : null,
    arrivedAt,
    // Un client n'est déclarable absent qu'après l'heure effective (vol retardé inclus) + attente minimale.
    noShowAllowedAt: arrivedAt ? new Date(Math.max(arrivedAt.getTime(), eff.getTime()) + NO_SHOW_WAIT_MIN * 60_000) : null,
  };
}
