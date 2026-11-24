import { Controller, Delete, Get, HttpException, Inject, Injectable, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Ride } from "@prisma/client";
import { DispatchService } from "./dispatch.service";
import { ecoBonusCents } from "./eco";
import { effectivePickup } from "./metrics";
import { NotificationsService } from "./notifications";
import { planningConfig } from "./planning";
import { PrismaService } from "./prisma";
import { DriverGuard } from "./security";
import { firstCompliant } from "./vehicle-rules";
import { WebhooksService } from "./webhooks.service";
import { swapMinHours, swapOpen } from "./swap-rules";

export { swapMinHours, swapOpen } from "./swap-rules";

@Injectable()
export class SwapService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  private tooLate() {
    return new HttpException(`Échange possible jusqu'à ${swapMinHours()} h avant la prise en charge. Passé ce délai : rendre la mission ou appeler un sauveteur.`, 409);
  }

  async offer(driverId: string, rideId: string, now = new Date()) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.driverId !== driverId) throw new HttpException("Course introuvable", 404);
    if (ride.status !== "ASSIGNED") throw new HttpException("Seule une mission acceptée et pas encore commencée peut être échangée", 409);
    if (!swapOpen(effectivePickup(ride.pickupAt, ride.flightDelayMin), now)) throw this.tooLate();
    const rescue = await this.prisma.rescueRequest.findFirst({ where: { rideId, status: "OPEN" }, select: { id: true } });
    if (rescue) throw new HttpException("Un appel à un sauveteur est déjà en cours pour cette mission", 409);
    if (ride.swapOfferedAt) return { ref: ride.ref, swapOfferedAt: ride.swapOfferedAt };
    const r = await this.prisma.ride.update({ where: { id: rideId }, data: { swapOfferedAt: now } });
    await this.prisma.rideEvent.create({ data: { rideId, type: "swap.offered", actor: `driver:${driverId}` } });
    return { ref: r.ref, swapOfferedAt: r.swapOfferedAt };
  }

  async withdraw(driverId: string, rideId: string) {
    const res = await this.prisma.ride.updateMany({ where: { id: rideId, driverId, swapOfferedAt: { not: null } }, data: { swapOfferedAt: null } });
    if (res.count !== 1) throw new HttpException("Mission introuvable ou pas à l'échange", 404);
    await this.prisma.rideEvent.create({ data: { rideId, type: "swap.withdrawn", actor: `driver:${driverId}` } });
    return { ok: true };
  }

  /** Missions à l'échange que CE chauffeur peut reprendre (véhicule conforme et équipé, planning libre, repos respecté). */
  async board(driverId: string, now = new Date()) {
    const me = await this.prisma.driver.findUnique({ where: { id: driverId }, include: { vehicles: { where: { active: true } } } });
    if (!me || me.status !== "ACTIVE") return [];
    const rides = await this.prisma.ride.findMany({
      where: { status: "ASSIGNED", swapOfferedAt: { not: null }, driverId: { not: driverId }, pickupAt: { gte: new Date(now.getTime() + (swapMinHours() - 24) * 3600_000) } },
      orderBy: { pickupAt: "asc" }, take: 50,
    });
    const out = [];
    for (const r of rides) {
      if (!(await this.eligible(this.prisma, driverId, me.vehicles, r, now))) continue;
      out.push({
        id: r.id, ref: r.ref, pickupAt: r.pickupAt, pickupAddress: r.pickupAddress, dropoffAddress: r.dropoffAddress, category: r.category,
        distanceKm: r.distanceKm, durationMin: r.durationMin, passengers: r.passengers, luggage: r.luggage, needs: r.needs,
        // Même prix de base que celui accepté par le collègue ; la prime électrique dépend du véhicule de celui qui reprend.
        driverNetCents: r.driverNetCents - r.ecoBonusCents,
      });
    }
    return out;
  }

  private async eligible(db: any, driverId: string, vehicles: Parameters<typeof firstCompliant>[0], ride: Ride, now: Date) {
    if (!swapOpen(effectivePickup(ride.pickupAt, ride.flightDelayMin), now)) return false;
    if (!firstCompliant(vehicles.filter((v) => v.category === ride.category), ride.category, ride.needs)) return false;
    if (await this.dispatch.hasOverlap(db, driverId, ride)) return false;
    return !(await this.dispatch.fatigueBlocked(db, driverId, ride));
  }

  async take(driverId: string, rideId: string, now = new Date()) {
    let from = "", ref = 0;
    await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride || ride.status !== "ASSIGNED" || !ride.swapOfferedAt || !ride.driverId) throw new HttpException("Mission plus disponible à l'échange", 409);
      if (ride.driverId === driverId) throw new HttpException("C'est déjà votre mission", 409);
      if (!swapOpen(effectivePickup(ride.pickupAt, ride.flightDelayMin), now)) throw this.tooLate();
      const me = await tx.driver.findUnique({ where: { id: driverId }, include: { vehicles: { where: { active: true, category: ride.category } } } });
      if (!me || me.status !== "ACTIVE") throw new HttpException("Compte non actif", 403);
      const vehicle = firstCompliant(me.vehicles, ride.category, ride.needs);
      if (!vehicle) throw new HttpException(ride.needs.length ? "Aucun véhicule compatible, conforme et équipé pour les besoins du voyageur" : "Aucun véhicule compatible et conforme", 409);
      if (await this.dispatch.hasOverlap(tx, driverId, ride)) throw new HttpException("Conflit avec une autre course de votre planning", 409);
      if (await this.dispatch.fatigueBlocked(tx, driverId, ride)) throw new HttpException(`Repos nécessaire : avec cette mission, vous dépasseriez ${planningConfig().maxMissionHours} h de mission sur 24 h`, 409);
      const base = ride.driverNetCents - ride.ecoBonusCents;
      const eco = ecoBonusCents(vehicle.fuel, ride.priceCents, ride.priceCents - base);
      // Condition sur le chauffeur d'origine et l'offre : deux collègues qui cliquent en même temps, un seul gagne.
      const res = await tx.ride.updateMany({
        where: { id: rideId, status: "ASSIGNED", driverId: ride.driverId, swapOfferedAt: { not: null } },
        data: { driverId, vehicleId: vehicle.id, swapOfferedAt: null, driverNetCents: base + eco, ecoBonusCents: eco, commissionCents: ride.priceCents - base - eco, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new HttpException("Mission plus disponible à l'échange", 409);
      await tx.rideEvent.create({ data: { rideId, type: "swap.taken", actor: `driver:${driverId}`, payload: { from: ride.driverId, to: driverId } } });
      // Le partenaire voit le nouveau chauffeur comme pour toute attribution.
      await this.webhooks.enqueue(tx, rideId, "driver.assigned");
      from = ride.driverId; ref = ride.ref;
    });
    await this.notif.toDriver(from, { type: "SWAP_TAKEN", title: "Mission reprise", body: `Un collègue a repris la mission R-${ref}. Elle n'est plus dans votre planning, sans pénalité.`, data: { rideId, ref } });
    return { ok: true, ref };
  }
}

@Controller("driver")
@UseGuards(DriverGuard)
export class DriverSwapController {
  constructor(@Inject(SwapService) private svc: SwapService) {}
  @Get("swaps") board(@Req() req: any) { return this.svc.board(req.driverId); }
  @Post("swaps/:id/take") take(@Req() req: any, @Param("id") id: string) { return this.svc.take(req.driverId, id); }
  @Post("rides/:id/swap") offer(@Req() req: any, @Param("id") id: string) { return this.svc.offer(req.driverId, id); }
  @Delete("rides/:id/swap") withdraw(@Req() req: any, @Param("id") id: string) { return this.svc.withdraw(req.driverId, id); }
}
