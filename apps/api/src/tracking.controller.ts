import { Controller, Get, HttpException, Inject, Param, Req, Res } from "@nestjs/common";
import { SlidingLimiter } from "./hardening";
import { effectivePickup } from "./metrics";
import { shareablePhoto } from "./identity.service";
import { PrismaService } from "./prisma";

const ACTIVE = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"];

/**
 * Suivi voyageur : page publique accessible par un lien secret (jeton de 192 bits, non devinable), sans compte.
 * Ne divulgue que l'utile : statut, adresses, heure, vol, prénom du chauffeur, véhicule, plaque, et sa photo s'il y a consenti.
 * Jamais de téléphone du chauffeur, de nom de famille, de prix ni de position en temps réel.
 */
@Controller("track")
export class TrackingController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  private limiter = new SlidingLimiter();

  /** Les liens de suivi sont publics : limite par adresse IP (la page se rafraîchit toutes les 10 s, soit 6 appels par minute). */
  private throttle(req: any) {
    const max = Number(process.env.TRACK_IP_PER_MIN) || 60;
    if (!this.limiter.allow(req.ip ?? "?", max)) throw new HttpException("Trop de requêtes, réessayez dans une minute", 429);
  }

  private async find(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpException("Lien de suivi introuvable", 404);
    const b = await this.prisma.booking.findUnique({ where: { trackingToken: token }, include: { rides: { include: { driver: true, vehicle: true }, orderBy: { createdAt: "desc" }, take: 1 } } });
    const ride = b?.rides[0];
    if (!b || !ride) throw new HttpException("Lien de suivi introuvable", 404);
    return { b, ride };
  }

  @Get(":token")
  async get(@Param("token") token: string, @Req() req: any) {
    this.throttle(req);
    const { b, ride } = await this.find(token);
    const active = !!ride.driver && ACTIVE.includes(ride.status);
    const photo = active && ride.driverId ? await shareablePhoto(this.prisma, ride.driverId) : null;
    return {
      language: ["fr", "en"].includes(b.passengerLanguage) ? b.passengerLanguage : "en",
      reference: `R-${ride.ref}`,
      status: ride.status,
      passengerFirstName: b.passengerFirstName,
      pickup: ride.pickupAddress, dropoff: ride.dropoffAddress,
      pickupAt: effectivePickup(ride.pickupAt, ride.flightDelayMin).toISOString(),
      signText: b.signText ?? `${b.passengerFirstName} ${b.passengerLastName}`,
      notes: b.notes,
      flight: b.flightNumber ? { number: b.flightNumber, status: ride.flightStatus ?? "SCHEDULED", delayMin: ride.flightDelayMin, earlyMin: ride.flightEarlyMin } : null,
      // Le chauffeur n'est montré que de l'attribution à la fin de la course.
      driver: active ? {
        firstName: ride.driver!.firstName,
        vehicle: ride.vehicle ? `${ride.vehicle.make} ${ride.vehicle.model}` : null,
        plate: ride.vehicle?.plate ?? null,
        photoUrl: photo ? `/track/${token}/photo` : null,
      } : null,
    };
  }

  @Get(":token/photo")
  async photo(@Param("token") token: string, @Req() req: any, @Res() res: any) {
    this.throttle(req);
    const { ride } = await this.find(token);
    const photo = ride.driverId && ACTIVE.includes(ride.status) ? await shareablePhoto(this.prisma, ride.driverId) : null;
    if (!photo) throw new HttpException("Photo indisponible", 404);
    res.set({ "Content-Type": photo.mime, "Cache-Control": "private, no-store", "Cross-Origin-Resource-Policy": "cross-origin" }).send(photo.image);
  }
}
