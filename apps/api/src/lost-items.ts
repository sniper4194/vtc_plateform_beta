import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SlidingLimiter } from "./hardening";
import { parse } from "./http";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";
import { AdminGuard, DriverGuard } from "./security";

/** Jours après la fin de la course pendant lesquels le voyageur peut signaler un objet oublié (valeur de départ, à confirmer). */
export const lostItemDays = (env: NodeJS.ProcessEnv = process.env) => {
  const v = Number(env.LOST_ITEM_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 7;
};

/** Vrai si le signalement est encore possible : course terminée il y a moins de `days` jours. */
export function lostItemOpen(completedAt: Date | null, now: Date, days = lostItemDays()) {
  return !!completedAt && now.getTime() - completedAt.getTime() <= days * 86400_000;
}

/** Ce que voit le voyageur : jamais le nom ni le téléphone du chauffeur. */
export const travelerView = (l: { status: string; createdAt: Date; answeredAt: Date | null }) => ({ status: l.status, reportedAt: l.createdAt, answeredAt: l.answeredAt });

@Injectable()
export class LostItemService {
  constructor(@Inject(PrismaService) private prisma: PrismaService, @Inject(NotificationsService) private notif: NotificationsService) {}

  async completedAt(rideId: string) {
    const e = await this.prisma.rideEvent.findFirst({ where: { rideId, type: "ride.completed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return e?.createdAt ?? null;
  }

  /** Signalement du voyageur depuis sa page de suivi (le lien secret fait office d'identification). */
  async report(token: string, description: string, now = new Date()) {
    const b = await this.prisma.booking.findUnique({ where: { trackingToken: token }, include: { rides: { orderBy: { createdAt: "desc" }, take: 1 } } });
    const ride = b?.rides[0];
    if (!b || !ride) throw new HttpException("Lien de suivi introuvable", 404);
    if (ride.status !== "COMPLETED" || !lostItemOpen(await this.completedAt(ride.id), now)) {
      throw new HttpException(`Signalement possible pendant ${lostItemDays()} jours après la fin du trajet. Passé ce délai, contactez l'organisateur de votre réservation.`, 409);
    }
    const open = await this.prisma.lostItem.count({ where: { rideId: ride.id, status: { in: ["OPEN", "FOUND"] } } });
    if (open) throw new HttpException("Un signalement est déjà en cours pour ce trajet", 409);
    const item = await this.prisma.lostItem.create({ data: { rideId: ride.id, driverId: ride.driverId, description: description.trim() } });
    if (ride.driverId) {
      await this.notif.toDriver(ride.driverId, {
        type: "LOST_ITEM", title: "Objet oublié signalé",
        body: `Le voyageur de la mission R-${ride.ref} pense avoir oublié : « ${item.description} ». Vérifiez votre véhicule et répondez dans l'application.`,
        data: { lostItemId: item.id, rideId: ride.id, ref: ride.ref },
      });
    }
    return travelerView(item);
  }

  async forDriver(driverId: string) {
    const rows = await this.prisma.lostItem.findMany({ where: { driverId }, orderBy: { createdAt: "desc" }, take: 30, include: { ride: { select: { ref: true, pickupAt: true, dropoffAddress: true } } } });
    return rows.map((l) => ({ id: l.id, ref: l.ride.ref, pickupAt: l.ride.pickupAt, dropoff: l.ride.dropoffAddress, description: l.description, status: l.status, driverNote: l.driverNote, createdAt: l.createdAt }));
  }

  async answer(driverId: string, id: string, input: { found: boolean; note?: string }) {
    const res = await this.prisma.lostItem.updateMany({
      where: { id, driverId, status: "OPEN" },
      data: { status: input.found ? "FOUND" : "NOT_FOUND", driverNote: input.note?.trim() || null, answeredAt: new Date() },
    });
    if (res.count !== 1) throw new HttpException("Signalement introuvable ou déjà traité", 404);
    return { ok: true };
  }

  async list(status?: string) {
    const rows = await this.prisma.lostItem.findMany({
      where: status ? { status: status as any } : {}, orderBy: { createdAt: "desc" }, take: 200,
      include: { ride: { select: { ref: true, pickupAt: true, booking: { select: { passengerFirstName: true, passengerLastName: true, passengerPhone: true, passengerEmail: true, partner: { select: { name: true } } } }, driver: { select: { firstName: true, lastName: true, phone: true } } } } },
    });
    return rows.map((l) => ({
      id: l.id, ref: l.ride.ref, status: l.status, description: l.description, driverNote: l.driverNote, createdAt: l.createdAt, answeredAt: l.answeredAt, closedAt: l.closedAt, closedBy: l.closedBy,
      passenger: { name: `${l.ride.booking.passengerFirstName} ${l.ride.booking.passengerLastName}`, phone: l.ride.booking.passengerPhone, email: l.ride.booking.passengerEmail },
      partner: l.ride.booking.partner?.name ?? null,
      driver: l.ride.driver ? { name: `${l.ride.driver.firstName} ${l.ride.driver.lastName}`, phone: l.ride.driver.phone } : null,
    }));
  }

  async close(id: string, actor: string, status: "RETURNED" | "CLOSED") {
    const res = await this.prisma.lostItem.updateMany({ where: { id, status: { in: ["OPEN", "FOUND", "NOT_FOUND"] } }, data: { status, closedBy: actor, closedAt: new Date() } });
    if (res.count !== 1) throw new HttpException("Signalement introuvable ou déjà clos", 404);
    await this.prisma.auditLog.create({ data: { actor, action: `lost_item.${status.toLowerCase()}`, entity: "LostItem", entityId: id } });
    return { ok: true };
  }
}

const ReportSchema = z.object({ description: z.string().trim().min(3, "Décrivez l'objet en quelques mots").max(300) });

/** Page de suivi : le voyageur signale un objet oublié. Public (lien secret) : limité par adresse IP. */
@Controller("track")
export class TrackLostItemController {
  private limiter = new SlidingLimiter();
  constructor(@Inject(LostItemService) private svc: LostItemService) {}
  @Post(":token/lost-item") report(@Param("token") token: string, @Req() req: any, @Body() body: unknown) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpException("Lien de suivi introuvable", 404);
    if (!this.limiter.allow(req.ip ?? "?", Number(process.env.LOST_ITEM_IP_PER_HOUR) || 10, 3600_000)) throw new HttpException("Trop de tentatives, réessayez plus tard", 429);
    return this.svc.report(token, parse(ReportSchema, body).description);
  }
}

@Controller("driver/lost-items")
@UseGuards(DriverGuard)
export class DriverLostItemController {
  constructor(@Inject(LostItemService) private svc: LostItemService) {}
  @Get() list(@Req() req: any) { return this.svc.forDriver(req.driverId); }
  @Post(":id/answer") answer(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.answer(req.driverId, id, parse(z.object({ found: z.boolean(), note: z.string().max(300).optional() }), body));
  }
}

@Controller("admin/lost-items")
@UseGuards(AdminGuard)
export class AdminLostItemController {
  constructor(@Inject(LostItemService) private svc: LostItemService) {}
  @Get() list(@Query("status") status?: string) { return this.svc.list(status); }
  // Opérationnel : régulateurs et administrateurs peuvent clore (l'auteur est tracé dans le journal).
  @Post(":id/close") close(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.close(id, req.admin.actor, parse(z.object({ status: z.enum(["RETURNED", "CLOSED"]) }), body).status);
  }
}
