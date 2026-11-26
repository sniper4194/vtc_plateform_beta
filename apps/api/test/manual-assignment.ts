import type { PrismaClient } from "@prisma/client";
import { driverOfferCents } from "../src/ladder";
import { effectivePickup } from "../src/metrics";
import { config, signToken } from "../src/security";

export async function manualAssignment(prisma: PrismaClient, rideId: string, driverId: string, priceCents?: number) {
  const email = "manual-assignment@example.test";
  const user = await prisma.adminUser.upsert({
    where: { email },
    update: { name: "Dispatch test" },
    create: { email, name: "Dispatch test", passwordHash: "unused" },
  });
  const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
  const cap = ride.driverCapCents || ride.driverNetCents;
  return {
    token: signToken({ sub: user.id, role: "admin", tv: user.tokenVersion }, config.tokenSecret, 60),
    body: {
      driverId,
      priceCents: priceCents ?? driverOfferCents(cap, effectivePickup(ride.pickupAt, ride.flightDelayMin), new Date()),
      verbalConsentConfirmed: true,
    },
  };
}
