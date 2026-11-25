import { Inject, Injectable } from "@nestjs/common";
import { daysLeft, deadlineStatus, DOC_LABEL, expiryMessage, thresholdFor } from "./deadlines";
import { missingDocuments, requiredDocs } from "./driver-docs";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";

const ACTIVE_RIDE = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] as const;

@Injectable()
export class DeadlinesService {
  private lastRun = 0;
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  /** Tableau des échéances d'un chauffeur : un état par document obligatoire (le plus récent valide l'emporte). */
  async list(driverId: string, now = new Date()) {
    const docs = await this.prisma.document.findMany({ where: { driverId }, orderBy: { createdAt: "desc" } });
    return requiredDocs().map((type) => {
      const ofType = docs.filter((d) => d.type === type);
      // Le document pris en compte : l'approuvé à l'échéance la plus lointaine, sinon le plus récent.
      const approved = ofType.filter((d) => d.status === "APPROVED").sort((a, b) => (b.expiresAt?.getTime() ?? Infinity) - (a.expiresAt?.getTime() ?? Infinity));
      const doc = approved[0] ?? ofType[0] ?? null;
      const s = deadlineStatus(doc, now);
      return { type, label: DOC_LABEL[type] ?? type, status: s.status, daysLeft: s.days, expiresAt: doc?.expiresAt ?? null };
    }).sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  }

  /**
   * Envoie les rappels (une seule fois par document et par palier) et met hors ligne les chauffeurs dont un document obligatoire a expiré,
   * sauf pendant une mission. Limité à un passage par heure.
   */
  async sweep(now = new Date(), force = false) {
    if (!force && now.getTime() - this.lastRun < 3600_000) return { reminded: 0, offline: 0 };
    this.lastRun = now.getTime();
    const horizon = new Date(now.getTime() + 31 * 86400_000);
    const docs = await this.prisma.document.findMany({
      where: { status: "APPROVED", type: { in: requiredDocs() as any }, expiresAt: { not: null, lte: horizon }, driver: { status: "ACTIVE" } },
      include: { driver: true },
    });
    let reminded = 0;
    for (const d of docs) {
      const days = daysLeft(d.expiresAt!, now);
      const t = thresholdFor(days);
      if (t === null) continue;
      // Un document déjà remplacé par un plus récent valide du même type ne déclenche rien.
      const newer = await this.prisma.document.findFirst({ where: { driverId: d.driverId, type: d.type, status: "APPROVED", id: { not: d.id }, OR: [{ expiresAt: null }, { expiresAt: { gt: d.expiresAt! } }] } });
      if (newer) continue;
      try { await this.prisma.documentReminder.create({ data: { documentId: d.id, threshold: t } }); } catch { continue; } // déjà envoyé
      await this.notif.toDriver(d.driverId, { ...expiryMessage(d.type, days, d.expiresAt!), data: { documentId: d.id, type: d.type, daysLeft: days } }, { email: t <= 7 });
      reminded++;
    }
    // Document obligatoire expiré : hors ligne (le compte reste actif ; la mise en ligne est refusée jusqu'au renouvellement).
    const online = await this.prisma.driver.findMany({
      where: { status: "ACTIVE", availability: "AVAILABLE", rides: { none: { status: { in: [...ACTIVE_RIDE] } } } }, select: { id: true },
    });
    let offline = 0;
    for (const d of online) {
      if ((await missingDocuments(this.prisma, d.id)).length === 0) continue;
      const r = await this.prisma.driver.updateMany({ where: { id: d.id, availability: "AVAILABLE" }, data: { availability: "SUSPENDED" } });
      offline += r.count;
    }
    return { reminded, offline };
  }

  /** Documents qui expirent bientôt, pour l'équipe. */
  async expiring(days = 30, now = new Date()) {
    const rows = await this.prisma.document.findMany({
      where: { status: "APPROVED", type: { in: requiredDocs() as any }, expiresAt: { not: null, lte: new Date(now.getTime() + days * 86400_000) }, driver: { status: "ACTIVE" } },
      include: { driver: true }, orderBy: { expiresAt: "asc" }, take: 200,
    });
    return rows.map((r) => ({ documentId: r.id, driverId: r.driverId, driver: `${r.driver.firstName} ${r.driver.lastName}`, type: r.type, label: DOC_LABEL[r.type] ?? r.type, expiresAt: r.expiresAt, daysLeft: daysLeft(r.expiresAt!, now) }));
  }
}
