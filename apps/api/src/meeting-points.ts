import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { SlidingLimiter } from "./hardening";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { imageMime, proofLimits } from "./proof";
import { AdminGuard, AdminOnly, DriverGuard } from "./security";
import { haversineKm } from "./zones";

/** Rayon autour du lieu de prise en charge dans lequel on cherche un point de rendez-vous validé (mètres). */
export const meetingRadiusM = (env: NodeJS.ProcessEnv = process.env) => Math.max(0, Number(env.MEETING_POINT_RADIUS_M) || 500);

/** Le point validé le plus proche du lieu de prise en charge, dans le rayon ; null sinon. */
export function nearestPoint<T extends { lat: number; lng: number }>(points: T[], at: { lat: number; lng: number }, radiusM = meetingRadiusM()): (T & { distanceM: number }) | null {
  let best: (T & { distanceM: number }) | null = null;
  for (const p of points) {
    const d = Math.round(haversineKm(p, at) * 1000);
    if (d <= radiusM && (!best || d < best.distanceM)) best = { ...p, distanceM: d };
  }
  return best;
}

@Injectable()
export class MeetingPointService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async submit(driverId: string, input: { label: string; note?: string; image: string; lat: number; lng: number; accuracyM?: number }) {
    const buf = Buffer.from(input.image, "base64");
    const max = proofLimits().maxBytes;
    if (buf.length > max) throw new HttpException(`Image trop lourde (${Math.round(max / 1000)} Ko maximum)`, 413);
    const mime = imageMime(buf);
    if (!mime) throw new HttpException("Format d'image non reconnu (JPEG ou PNG)", 422);
    const p = await this.prisma.meetingPoint.create({
      data: { label: input.label.trim(), note: input.note?.trim() || null, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM ?? null, mime, image: buf, imageSha256: createHash("sha256").update(buf).digest("hex"), submittedBy: driverId },
    });
    return { id: p.id, status: p.status, label: p.label };
  }

  /** Points validés proches d'un lieu (pour le suivi voyageur). */
  async nearestApproved(at: { lat: number; lng: number }) {
    const r = meetingRadiusM() / 1000, dLat = r / 111, dLng = r / (111 * Math.max(0.2, Math.cos((at.lat * Math.PI) / 180)));
    const pts = await this.prisma.meetingPoint.findMany({
      where: { status: "APPROVED", lat: { gte: at.lat - dLat, lte: at.lat + dLat }, lng: { gte: at.lng - dLng, lte: at.lng + dLng } },
      select: { id: true, label: true, note: true, lat: true, lng: true },
    });
    return nearestPoint(pts, at);
  }

  async photo(id: string, approvedOnly = false) {
    const p = await this.prisma.meetingPoint.findUnique({ where: { id } });
    if (!p || (approvedOnly && p.status !== "APPROVED")) throw new HttpException("Photo introuvable", 404);
    return { mime: p.mime, image: Buffer.from(p.image) };
  }

  async list(status?: string) {
    const rows = await this.prisma.meetingPoint.findMany({
      where: status ? { status: status as any } : {}, orderBy: { createdAt: "desc" }, take: 200,
      select: { id: true, label: true, note: true, lat: true, lng: true, accuracyM: true, status: true, submittedBy: true, reviewedBy: true, reviewedAt: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, photo: `/admin/meeting-points/${r.id}/photo` }));
  }

  async review(id: string, actor: string, input: { status: "APPROVED" | "REJECTED"; label?: string; note?: string | null }) {
    const p = await this.prisma.meetingPoint.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new HttpException("Point introuvable", 404);
    const row = await this.prisma.meetingPoint.update({
      where: { id }, data: { status: input.status, reviewedBy: actor, reviewedAt: new Date(), ...(input.label ? { label: input.label.trim() } : {}), ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}) },
    });
    await this.prisma.auditLog.create({ data: { actor, action: `meeting_point.${input.status === "APPROVED" ? "approved" : "rejected"}`, entity: "MeetingPoint", entityId: id } });
    return { id: row.id, status: row.status, label: row.label, note: row.note };
  }
}

const SubmitSchema = z.object({
  label: z.string().trim().min(3).max(80), note: z.string().max(300).optional(), image: z.string().min(100).max(1_000_000),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100_000).optional(),
});

/** Un chauffeur propose un point de rendez-vous ; il n'est montré aux voyageurs qu'après validation par l'équipe. */
@Controller("driver/meeting-points")
@UseGuards(DriverGuard)
export class DriverMeetingPointController {
  private limiter = new SlidingLimiter();
  constructor(@Inject(MeetingPointService) private svc: MeetingPointService) {}
  @Post() submit(@Req() req: any, @Body() body: unknown) {
    if (!this.limiter.allow(req.driverId, Number(process.env.MEETING_POINTS_PER_DAY) || 10, 86_400_000)) throw new HttpException("Limite de propositions atteinte pour aujourd'hui", 429);
    return this.svc.submit(req.driverId, parse(SubmitSchema, body));
  }
}

@Controller("admin/meeting-points")
@UseGuards(AdminGuard)
export class AdminMeetingPointController {
  constructor(@Inject(MeetingPointService) private svc: MeetingPointService) {}
  @Get() list(@Query("status") status?: string) { return this.svc.list(status); }
  @Get(":id/photo") async photo(@Param("id") id: string, @Res() res: any) {
    const p = await this.svc.photo(id);
    res.set({ "Content-Type": p.mime, "Cache-Control": "private, no-store" }).send(p.image);
  }
  @Post(":id/review") @AdminOnly() review(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.review(id, req.admin.actor, parse(z.object({ status: z.enum(["APPROVED", "REJECTED"]), label: z.string().trim().min(3).max(80).optional(), note: z.string().max(300).nullable().optional() }), body));
  }
}
