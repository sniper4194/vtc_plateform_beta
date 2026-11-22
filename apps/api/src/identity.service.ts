import { HttpException, Inject, Injectable } from "@nestjs/common";
import { missingIdentifiers } from "./driver-docs";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";

const num = (k: string, d: number) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : d);
export const IDENTITY = {
  get enabled() { return process.env.IDENTITY_CHECKS !== "0"; },
  get validHours() { return num("IDENTITY_CHECK_HOURS", 12); }, // durée de validité d'un selfie de prise de service
  get retentionDays() { return num("IDENTITY_RETENTION_DAYS", 30); }, // conservation des selfies de prise de service (la référence reste tant que le compte existe)
  maxBytes: 400_000,
};

@Injectable()
export class IdentityService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  /** État du contrôle d'identité du chauffeur. */
  async state(driverId: string) {
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    const ref = await this.prisma.identityCheck.findFirst({ where: { driverId, kind: "REFERENCE", status: { in: ["VALID", "PENDING"] } }, orderBy: { createdAt: "desc" } });
    const validUntil = d.identityVerifiedAt ? new Date(d.identityVerifiedAt.getTime() + IDENTITY.validHours * 3600_000) : null;
    const fresh = !!validUntil && validUntil > new Date();
    const referenceStatus = ref?.status ?? "NONE";
    return {
      enabled: IDENTITY.enabled, referenceStatus, verifiedAt: d.identityVerifiedAt, validUntil,
      mustVerify: IDENTITY.enabled && !(referenceStatus === "VALID" && fresh), validHours: IDENTITY.validHours,
    };
  }

  /** Doit-on empêcher ce chauffeur de se mettre en ligne ? Renvoie le motif lisible, ou null. */
  async blockReason(driverId: string): Promise<string | null> {
    const s = await this.state(driverId);
    if (!s.mustVerify) return null;
    if (s.referenceStatus === "NONE") return "Prenez un selfie pour vérifier votre identité avant de vous mettre en ligne";
    if (s.referenceStatus === "PENDING") return "Votre photo est en cours de validation par l'équipe";
    return `Votre selfie de prise de service a plus de ${IDENTITY.validHours} h : reprenez-en un`;
  }

  async submitSelfie(driverId: string, imageBase64: string, mime: string) {
    const buf = Buffer.from(imageBase64, "base64");
    if (!buf.length) throw new HttpException("Image vide", 422);
    if (buf.length > IDENTITY.maxBytes) throw new HttpException("Image trop lourde (400 Ko maximum)", 413);
    // Contrôle élémentaire du format (JPEG ou PNG) : on ne stocke pas n'importe quel fichier.
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8, isPng = buf[0] === 0x89 && buf[1] === 0x50;
    if (!isJpeg && !isPng) throw new HttpException("Format d'image non reconnu (JPEG ou PNG)", 422);
    const ref = await this.prisma.identityCheck.findFirst({ where: { driverId, kind: "REFERENCE", status: "VALID" } });
    if (!ref) {
      // Première photo (ou reprise après refus) : référence, validée par un humain. Une référence en attente est remplacée.
      await this.prisma.identityCheck.deleteMany({ where: { driverId, kind: "REFERENCE", status: "PENDING" } });
      await this.prisma.identityCheck.create({ data: { driverId, kind: "REFERENCE", status: "PENDING", mime: isPng ? "image/png" : "image/jpeg", image: buf } });
      return { kind: "REFERENCE", status: "PENDING", message: "Photo reçue : l'équipe la valide avant votre première mise en ligne." };
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.identityCheck.create({ data: { driverId, kind: "SHIFT", status: "VALID", mime: isPng ? "image/png" : "image/jpeg", image: buf } }),
      this.prisma.driver.update({ where: { id: driverId }, data: { identityVerifiedAt: now } }),
    ]);
    return { kind: "SHIFT", status: "VALID", validUntil: new Date(now.getTime() + IDENTITY.validHours * 3600_000) };
  }

  /** Remet hors ligne les chauffeurs dont le selfie a expiré (hors mission en cours) et purge les anciens selfies de prise de service. */
  async sweep(now = new Date()) {
    if (IDENTITY.enabled) {
      const cutoff = new Date(now.getTime() - IDENTITY.validHours * 3600_000);
      const stale = await this.prisma.driver.findMany({
        where: { availability: "AVAILABLE", OR: [{ identityVerifiedAt: null }, { identityVerifiedAt: { lt: cutoff } }], rides: { none: { status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } } } },
        select: { id: true },
      });
      for (const d of stale) {
        const r = await this.prisma.driver.updateMany({ where: { id: d.id, availability: "AVAILABLE" }, data: { availability: "SUSPENDED" } });
        if (r.count === 1) await this.notif.toDriver(d.id, { type: "IDENTITY_REQUIRED", title: "Selfie de prise de service", body: `Pour votre sécurité et celle de vos clients, un selfie est demandé toutes les ${IDENTITY.validHours} h. Reprenez-en un pour vous remettre en ligne.` });
      }
    }
    await this.prisma.identityCheck.deleteMany({ where: { kind: "SHIFT", createdAt: { lt: new Date(now.getTime() - IDENTITY.retentionDays * 86400_000) } } });
  }

  // ---- administration ----
  async adminList(status?: string) {
    const rows = await this.prisma.identityCheck.findMany({ where: status ? { status: status as any } : {}, include: { driver: true }, orderBy: { createdAt: "desc" }, take: 30 });
    const out = [];
    for (const r of rows) {
      const ref = r.kind === "SHIFT" ? await this.prisma.identityCheck.findFirst({ where: { driverId: r.driverId, kind: "REFERENCE", status: "VALID" }, orderBy: { createdAt: "desc" } }) : null;
      out.push({
        id: r.id, driverId: r.driverId, driver: `${r.driver.firstName} ${r.driver.lastName}`, kind: r.kind, status: r.status, createdAt: r.createdAt, reason: r.reason,
        image: `data:${r.mime};base64,${Buffer.from(r.image).toString("base64")}`,
        reference: ref ? `data:${ref.mime};base64,${Buffer.from(ref.image).toString("base64")}` : null,
      });
    }
    return out;
  }

  async review(id: string, approve: boolean, reason: string | undefined, actor: string) {
    const c = await this.prisma.identityCheck.findUnique({ where: { id } });
    if (!c) throw new HttpException("Contrôle introuvable", 404);
    if (!approve && !reason) throw new HttpException("Un motif est requis pour refuser", 422);
    const u = await this.prisma.identityCheck.updateMany({ where: { id, status: c.status }, data: { status: approve ? "VALID" : "REJECTED", reason: reason ?? null, reviewedBy: actor, reviewedAt: new Date() } });
    if (u.count !== 1) throw new HttpException("Conflit, réessayez", 409);
    if (approve && c.kind === "REFERENCE") {
      await this.prisma.driver.update({ where: { id: c.driverId }, data: { identityVerifiedAt: new Date() } });
      await this.notif.toDriver(c.driverId, { type: "IDENTITY_VALIDATED", title: "Identité validée", body: "Votre photo est validée. Vous pouvez vous mettre en ligne ; un selfie vous sera demandé à chaque prise de service." });
    }
    if (!approve) {
      if (c.kind === "SHIFT") {
        // Selfie qui ne correspond pas à la référence : suspicion de prêt de compte → compte suspendu pour examen.
        await this.prisma.driver.update({ where: { id: c.driverId }, data: { status: "SUSPENDED", availability: "SUSPENDED", suspendedBy: "admin", suspendedUntil: null, identityVerifiedAt: null } });
        await this.notif.toDriver(c.driverId, { type: "IDENTITY_REJECTED", title: "Compte suspendu : vérification d'identité", body: `Un selfie ne correspond pas à votre photo de référence (${reason}). Votre compte est suspendu dans l'attente d'un échange avec l'équipe.` }, { email: true });
      } else {
        await this.prisma.driver.update({ where: { id: c.driverId }, data: { identityVerifiedAt: null } });
        await this.notif.toDriver(c.driverId, { type: "IDENTITY_REJECTED", title: "Photo refusée", body: `Votre photo n'a pas pu être validée (${reason}). Reprenez un selfie net, de face, visage découvert.` });
      }
    }
    return { ok: true };
  }
}
