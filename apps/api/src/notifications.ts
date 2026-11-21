import { Inject, Injectable, Logger } from "@nestjs/common";
import { EmailService } from "./email";
import { PrismaService } from "./prisma";

export const fmtDateTime = (d: Date) =>
  d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtTime = (d: Date) => d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

export interface DriverMessage { type: string; title: string; body: string; data?: object }

@Injectable()
export class NotificationsService {
  private log = new Logger("notifications");
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(EmailService) private email: EmailService,
  ) {}

  /** Alerte légère (futur push) : journalisée seulement. */
  notifyDriver(driverId: string, message: string) {
    this.log.log(`→ chauffeur ${driverId} : ${message}`);
  }

  /**
   * Message persistant : visible dans l'app du chauffeur (c'est la source de vérité), avec relais e-mail facultatif.
   * Ne lève jamais : un échec d'envoi ne doit pas faire échouer l'opération métier qui l'a déclenché.
   */
  async toDriver(driverId: string, m: DriverMessage, opts: { email?: boolean } = {}) {
    try {
      const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { email: true } });
      await this.prisma.notification.create({ data: { driverId, type: m.type, title: m.title, body: m.body, data: m.data as any } });
      if (opts.email && driver?.email && this.email.provider) {
        await this.email.provider.send({ to: driver.email, subject: m.title, text: `${m.body}\n\n— ${process.env.BRAND_NAME ?? "Étoile"}` });
      }
    } catch (e: any) {
      this.log.warn(`notification chauffeur ${driverId} (${m.type}) : ${e?.message ?? e}`);
    }
  }
}
