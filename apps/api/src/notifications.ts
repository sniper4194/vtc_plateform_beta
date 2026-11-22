import { Inject, Injectable, Logger } from "@nestjs/common";
import { EmailService } from "./email";
import { passengerAlertSms, trackingMessage } from "./messages";
import { SmsService } from "./sms";
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
    @Inject(SmsService) private sms: SmsService,
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
        await this.email.provider.send({ to: driver.email, subject: m.title, text: `${m.body}\n\n— ${process.env.BRAND_NAME ?? "CliCab"}` });
      }
    } catch (e: any) {
      this.log.warn(`notification chauffeur ${driverId} (${m.type}) : ${e?.message ?? e}`);
    }
  }

  /**
   * Envoie au voyageur son lien de suivi par SMS et par e-mail (chaque canal indépendamment : l'échec de l'un n'empêche pas l'autre).
   * Ne lève jamais. Les clés de test (sandbox) n'envoient rien, sauf TRACKING_NOTIFY_SANDBOX=1. Marque la réservation si au moins un canal a abouti.
   */
  async trackingLink(rideId: string, sandbox: boolean) {
    try {
      if (sandbox && process.env.TRACKING_NOTIFY_SANDBOX !== "1") return;
      const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, include: { booking: { include: { partner: true } } } });
      const b = ride?.booking;
      if (!ride || !b?.trackingToken || b.trackingSentAt || b.partner?.notifyPassenger === false) return;
      const url = `${(process.env.TRACKING_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "")}/suivi/${b.trackingToken}`;
      const m = trackingMessage({ firstName: b.passengerFirstName, language: b.passengerLanguage, reference: `R-${ride.ref}`, pickupAt: ride.pickupAt, pickup: ride.pickupAddress, dropoff: ride.dropoffAddress, url });
      let sent = false;
      if (b.passengerPhone && this.sms.provider) {
        try { await this.sms.provider.send(b.passengerPhone, m.sms); sent = true; } catch (e: any) { this.log.warn(`SMS de suivi ${rideId} : ${e?.message ?? e}`); }
      }
      if (b.passengerEmail && this.email.provider) {
        try { await this.email.provider.send({ to: b.passengerEmail, subject: m.subject, text: m.text }); sent = true; } catch (e: any) { this.log.warn(`e-mail de suivi ${rideId} : ${e?.message ?? e}`); }
      }
      if (sent) await this.prisma.booking.update({ where: { id: b.id }, data: { trackingSentAt: new Date() } });
    } catch (e: any) {
      this.log.warn(`lien de suivi ${rideId} : ${e?.message ?? e}`);
    }
  }

  /**
   * Alerte SMS au voyageur : chauffeur arrivé (une fois par course) ou retard de vol (dès 15 min, puis à chaque aggravation d'au moins 15 min, 3 au plus).
   * Uniquement si son lien de suivi lui a bien été envoyé par nous (donc ni clé de test, ni partenaire qui s'en charge) et s'il a un numéro. Ne lève jamais.
   * Chaque alerte est tracée dans le journal de la course (`passenger.alert`), ce qui sert aussi d'anti-doublon.
   */
  async passengerAlert(rideId: string, kind: "ARRIVED" | "FLIGHT_DELAY") {
    try {
      if (!this.sms.provider) return;
      const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, include: { booking: true, driver: true, vehicle: true } });
      const b = ride?.booking;
      if (!ride || !b?.trackingToken || !b.trackingSentAt || !b.passengerPhone) return;
      const past = (await this.prisma.rideEvent.findMany({ where: { rideId, type: "passenger.alert" }, orderBy: { createdAt: "asc" } })).map((e) => e.payload as any).filter((p) => p?.kind === kind);
      const url = `${(process.env.TRACKING_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "")}/suivi/${b.trackingToken}`;
      let text: string, payload: Record<string, unknown>;
      if (kind === "ARRIVED") {
        if (past.length || !ride.driver) return;
        text = passengerAlertSms({ kind, language: b.passengerLanguage, driverFirstName: ride.driver.firstName, vehicle: ride.vehicle ? `${ride.vehicle.make} ${ride.vehicle.model}` : null, plate: ride.vehicle?.plate ?? null, url });
        payload = { kind };
      } else {
        const delay = ride.flightDelayMin;
        const last = past.length ? Number(past[past.length - 1].delayMin) : 0;
        if (!b.flightNumber || delay < 15 || past.length >= 3 || (past.length && delay - last < 15)) return;
        if (!["DISPATCHING", "ASSIGNED", "EN_ROUTE"].includes(ride.status)) return; // chauffeur déjà sur place ou course en cours : le retard n'a plus de sens
        text = passengerAlertSms({ kind, language: b.passengerLanguage, flightNumber: b.flightNumber, delayMin: delay, pickupAt: new Date(ride.pickupAt.getTime() + delay * 60_000), url });
        payload = { kind, delayMin: delay };
      }
      await this.prisma.rideEvent.create({ data: { rideId, type: "passenger.alert", actor: "system", payload: payload as any } });
      await this.sms.provider.send(b.passengerPhone, text);
    } catch (e: any) {
      this.log.warn(`alerte voyageur ${rideId} (${kind}) : ${e?.message ?? e}`);
    }
  }
}
