import { HttpException, Inject, Injectable } from "@nestjs/common";
import { IncidentKind } from "@prisma/client";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";

export const URGENT_BY_DEFAULT: IncidentKind[] = ["DANGER", "ACCIDENT"];
export const KIND_LABEL: Record<string, string> = {
  DANGER: "Danger (agression, menace)", ACCIDENT: "Accident", BREAKDOWN: "Panne ou véhicule immobilisé", CLIENT: "Comportement d'un client",
  PAYMENT: "Problème de paiement", CONTROL: "Contrôle routier ou verbalisation", OTHER: "Autre",
};
const MAX_PER_HOUR = 5;

/** Message de confirmation : l'équipe n'est pas un service d'urgence, et le dit. */
export function confirmationMessage(kind: IncidentKind, urgent: boolean) {
  const lines = [`Votre signalement « ${KIND_LABEL[kind]} » est enregistré avec l'heure et votre position. L'équipe est alertée.`];
  if (urgent) lines.push("", "En cas de danger immédiat, appelez d'abord les secours : 112 (urgences), 17 (police), 15 (SAMU), 18 (pompiers). Notre équipe ne remplace pas les secours.");
  if (kind === "BREAKDOWN") lines.push("", "Si la mission n'est pas commencée, vous pouvez aussi appeler un sauveteur depuis « Un souci ? » pour que quelqu'un la reprenne.");
  if (kind === "CONTROL") lines.push("", "Gardez votre justificatif de réservation prêt : il est dans l'écran de la mission.");
  return { type: "INCIDENT_RECEIVED", title: urgent ? "Alerte reçue" : "Signalement reçu", body: lines.join("\n") };
}

@Injectable()
export class IncidentService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  async create(driverId: string, input: { kind: IncidentKind; rideId?: string; message?: string; urgent?: boolean; lat?: number; lng?: number }) {
    const recent = await this.prisma.incident.count({ where: { driverId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= MAX_PER_HOUR) throw new HttpException("Trop de signalements en une heure : appelez le support ou les secours", 429);
    if (input.rideId) {
      const ride = await this.prisma.ride.findFirst({ where: { id: input.rideId, driverId }, select: { id: true } });
      if (!ride) throw new HttpException("Mission introuvable", 404);
    }
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { lastLat: true, lastLng: true } });
    const urgent = input.urgent ?? URGENT_BY_DEFAULT.includes(input.kind);
    const inc = await this.prisma.incident.create({
      data: { driverId, rideId: input.rideId ?? null, kind: input.kind, urgent, message: input.message?.trim() || null, lat: input.lat ?? d.lastLat, lng: input.lng ?? d.lastLng },
    });
    if (input.rideId) await this.prisma.rideEvent.create({ data: { rideId: input.rideId, type: "driver.incident", actor: `driver:${driverId}`, payload: { incidentId: inc.id, kind: input.kind, urgent } as any } });
    await this.notif.toDriver(driverId, { ...confirmationMessage(input.kind, urgent), data: { incidentId: inc.id } });
    return { id: inc.id, status: inc.status, urgent, kind: inc.kind, createdAt: inc.createdAt, located: inc.lat != null };
  }

  async mine(driverId: string) {
    const rows = await this.prisma.incident.findMany({ where: { driverId }, orderBy: { createdAt: "desc" }, take: 20 });
    return rows.map((r) => ({ id: r.id, kind: r.kind, label: KIND_LABEL[r.kind], urgent: r.urgent, status: r.status, createdAt: r.createdAt, resolution: r.resolution }));
  }

  // ---- équipe ----
  async adminList(status?: string) {
    const rows = await this.prisma.incident.findMany({
      where: status ? { status: status as any } : {}, include: { driver: true },
      orderBy: [{ status: "asc" }, { urgent: "desc" }, { createdAt: "desc" }], take: 100,
    });
    const rides = await this.prisma.ride.findMany({ where: { id: { in: rows.map((r) => r.rideId).filter(Boolean) as string[] } }, select: { id: true, ref: true } });
    const ref = new Map(rides.map((r) => [r.id, r.ref]));
    return rows.map((r) => ({
      id: r.id, kind: r.kind, label: KIND_LABEL[r.kind], urgent: r.urgent, status: r.status, message: r.message, createdAt: r.createdAt, ref: r.rideId ? ref.get(r.rideId) ?? null : null,
      driver: `${r.driver.firstName} ${r.driver.lastName}`, driverId: r.driverId, phone: r.driver.phone,
      map: r.lat != null && r.lng != null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : null, resolution: r.resolution, ackedBy: r.ackedBy,
    }));
  }

  async ack(id: string, actor: string) {
    const r = await this.prisma.incident.updateMany({ where: { id, status: "OPEN" }, data: { status: "ACKNOWLEDGED", ackedAt: new Date(), ackedBy: actor } });
    if (r.count !== 1) throw new HttpException("Signalement introuvable ou déjà pris en charge", 404);
    const inc = await this.prisma.incident.findUniqueOrThrow({ where: { id } });
    await this.notif.toDriver(inc.driverId, { type: "INCIDENT_ACK", title: "Signalement pris en charge", body: "Un membre de l'équipe a pris en charge votre signalement et peut vous rappeler.", data: { incidentId: id } });
    return { ok: true };
  }

  async close(id: string, resolution: string, actor: string) {
    const r = await this.prisma.incident.updateMany({ where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "CLOSED", closedAt: new Date(), closedBy: actor, resolution } });
    if (r.count !== 1) throw new HttpException("Signalement introuvable ou déjà clos", 404);
    const inc = await this.prisma.incident.findUniqueOrThrow({ where: { id } });
    await this.notif.toDriver(inc.driverId, { type: "INCIDENT_CLOSED", title: "Signalement clos", body: `Votre signalement est clos : ${resolution}`, data: { incidentId: id } });
    return { ok: true };
  }
}
