import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma";
import { signWebhook } from "./security";
import { bookingView } from "./views";

type Db = Prisma.TransactionClient | PrismaService;

export const MAX_DELIVERY_ATTEMPTS = 8;
export const backoffSeconds = (attempts: number) => Math.min(30 * 2 ** attempts, 3600);

@Injectable()
export class WebhooksService {
  private log = new Logger("webhooks");
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /** À appeler DANS la transaction qui change l'état (pattern outbox). */
  async enqueue(db: Db, rideId: string, eventType: string) {
    const ride = await db.ride.findUnique({
      where: { id: rideId },
      include: { booking: { include: { partner: true } }, driver: true, vehicle: true },
    });
    const partner = ride?.booking.partner;
    if (!ride || !partner?.webhookUrl || !partner.webhookSecret) return;
    await db.webhookDelivery.create({
      data: {
        partnerId: partner.id,
        eventType,
        payload: { type: eventType, createdAt: new Date().toISOString(), data: bookingView(ride) } as any,
      },
    });
  }

  /** Livre les webhooks dus ; renvoie le nombre de livraisons réussies. */
  async deliverDue(now = new Date()): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      include: { partner: true },
      orderBy: { nextAttemptAt: "asc" },
      take: 50,
    });
    let ok = 0;
    for (const d of due) {
      // « bail » de 60 s : empêche deux workers de livrer le même événement
      const claim = await this.prisma.webhookDelivery.updateMany({
        where: { id: d.id, status: "PENDING", nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(now.getTime() + 60_000) },
      });
      if (claim.count !== 1) continue;
      const url = d.partner.webhookUrl, secret = d.partner.webhookSecret;
      let error: string | null = null;
      if (!url || !secret) error = "webhook non configuré";
      else {
        const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
        const ts = Math.floor(Date.now() / 1000);
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-event-type": d.eventType,
              "x-delivery-id": d.id,
              "x-signature": `t=${ts},v1=${signWebhook(secret, body, ts)}`,
            },
            body,
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) error = `HTTP ${res.status}`;
        } catch (e: any) {
          error = e?.message ?? "erreur réseau";
        }
      }
      if (!error) {
        ok++;
        await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "DELIVERED", attempts: { increment: 1 }, lastError: null } });
      } else {
        const attempts = d.attempts + 1;
        this.log.warn(`webhook ${d.id} échec (${attempts}) : ${error}`);
        await this.prisma.webhookDelivery.update({
          where: { id: d.id },
          data: {
            attempts,
            lastError: error,
            status: attempts >= MAX_DELIVERY_ATTEMPTS ? "FAILED" : "PENDING",
            nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
          },
        });
      }
    }
    return ok;
  }
}
