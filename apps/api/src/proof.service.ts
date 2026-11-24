import { HttpException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "./prisma";
import { WebhooksService } from "./webhooks.service";
import { imageMime, PROOF_FLAG_LABEL, PROOF_LABEL, PROOF_STATUSES, proofFlags, proofLimits } from "./proof";
import { haversineKm } from "./zones";

export interface ProofInput {
  kind: "NO_SHOW" | "EXCESS_LUGGAGE" | "OTHER"; image: string; lat: number; lng: number; accuracyM?: number;
  address?: string; capturedAt?: string; note?: string;
}

@Injectable()
export class ProofService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
  ) {}

  private view(p: any, photoPath: string) {
    return {
      id: p.id, kind: p.kind, label: PROOF_LABEL[p.kind], note: p.note,
      receivedAt: p.receivedAt, // heure du serveur : fait foi
      deviceTakenAt: p.deviceTakenAt, // heure du téléphone : indicative
      location: { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, address: p.address },
      distanceToPickupM: p.distanceToPickupM,
      flags: p.flags.map((code: string) => ({ code, label: PROOF_FLAG_LABEL[code] ?? code })),
      sha256: p.imageSha256, photo: photoPath,
    };
  }

  // ---------- chauffeur ----------
  async create(driverId: string, rideId: string, input: ProofInput) {
    const lim = proofLimits();
    const ride = await this.prisma.ride.findFirst({ where: { id: rideId, driverId } });
    if (!ride) throw new HttpException("Mission introuvable", 404);
    if (!PROOF_STATUSES.includes(ride.status)) throw new HttpException("Une photo-preuve se prend une fois sur place, à l'arrivée ou pendant la course", 409);
    if ((await this.prisma.rideProof.count({ where: { rideId } })) >= lim.maxPerRide) throw new HttpException(`Limite de ${lim.maxPerRide} photos par mission atteinte`, 429);

    const buf = Buffer.from(input.image, "base64");
    if (buf.length > lim.maxBytes) throw new HttpException(`Image trop lourde (${Math.round(lim.maxBytes / 1000)} Ko maximum)`, 413);
    const mime = imageMime(buf);
    if (!mime) throw new HttpException("Format d'image non reconnu (JPEG ou PNG)", 422);

    const receivedAt = new Date();
    const deviceTakenAt = input.capturedAt ? new Date(input.capturedAt) : null;
    const distanceM = Math.round(haversineKm({ lat: input.lat, lng: input.lng }, { lat: ride.pickupLat, lng: ride.pickupLng }) * 1000);
    const flags = proofFlags({ distanceM, accuracyM: input.accuracyM, deviceTakenAt, receivedAt }, lim);
    const row = await this.prisma.$transaction(async (tx) => {
      const p = await tx.rideProof.create({
        data: {
          rideId, driverId, kind: input.kind, note: input.note?.trim() || null, mime, image: buf, imageSha256: createHash("sha256").update(buf).digest("hex"),
          receivedAt, deviceTakenAt, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM ?? null, address: input.address?.trim() || null, distanceToPickupM: distanceM, flags,
        },
      });
      await tx.rideEvent.create({ data: { rideId, type: "driver.proof", actor: `driver:${driverId}`, payload: { proofId: p.id, kind: input.kind, distanceM, flags } as any } });
      await this.webhooks.enqueue(tx, rideId, "ride.proof_added");
      return p;
    });
    return this.view(row, `/driver/rides/${rideId}/proofs/${row.id}/photo`);
  }

  async listForDriver(driverId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({ where: { id: rideId, driverId }, select: { id: true } });
    if (!ride) throw new HttpException("Mission introuvable", 404);
    const rows = await this.prisma.rideProof.findMany({ where: { rideId }, orderBy: { receivedAt: "asc" } });
    return rows.map((p) => this.view(p, `/driver/rides/${rideId}/proofs/${p.id}/photo`));
  }

  async photoForDriver(driverId: string, rideId: string, proofId: string) {
    const p = await this.prisma.rideProof.findFirst({ where: { id: proofId, rideId, driverId } });
    if (!p) throw new HttpException("Photo introuvable", 404);
    return { mime: p.mime, image: Buffer.from(p.image) };
  }

  // ---------- partenaire ----------
  private async partnerRide(partnerId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, partnerId }, include: { rides: { orderBy: { createdAt: "desc" }, take: 1 } } });
    const ride = b?.rides[0];
    if (!b || !ride) throw new HttpException("Réservation introuvable", 404);
    return ride;
  }

  async listForPartner(partnerId: string, bookingId: string) {
    const ride = await this.partnerRide(partnerId, bookingId);
    const rows = await this.prisma.rideProof.findMany({ where: { rideId: ride.id }, orderBy: { receivedAt: "asc" } });
    return rows.map((p) => this.view(p, `/v1/bookings/${bookingId}/proofs/${p.id}/photo`));
  }

  async photoForPartner(partnerId: string, bookingId: string, proofId: string) {
    const ride = await this.partnerRide(partnerId, bookingId);
    const p = await this.prisma.rideProof.findFirst({ where: { id: proofId, rideId: ride.id } });
    if (!p) throw new HttpException("Photo introuvable", 404);
    return { mime: p.mime, image: Buffer.from(p.image) };
  }

  // ---------- équipe ----------
  async listForAdmin(rideId: string) {
    const rows = await this.prisma.rideProof.findMany({ where: { rideId }, orderBy: { receivedAt: "asc" } });
    return rows.map((p) => this.view(p, `/admin/proofs/${p.id}/photo`));
  }

  async photoForAdmin(proofId: string) {
    const p = await this.prisma.rideProof.findUnique({ where: { id: proofId } });
    if (!p) throw new HttpException("Photo introuvable", 404);
    return { mime: p.mime, image: Buffer.from(p.image) };
  }
}
