import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Partner } from "@prisma/client";
import { computeQuote, findFlatRate, FlatRate, PricingConfig, VehicleCategory } from "@vtc/pricing";
import { QuoteRequest } from "@vtc/shared";
import { cents, euros } from "./http";
import { PrismaService } from "./prisma";
import { haversineKm, zonesOf } from "./zones";

/** Config par défaut, utilisée tant qu'aucun PricingRuleSet actif n'existe en base. */
export const DEFAULT_PRICING: PricingConfig = {
  baseFare: 5, perKm: 1.2, perMinute: 0.4, minFare: 15,
  categoryMultiplier: { BERLINE: 1, BUSINESS: 1.3, VAN: 1.5, GREEN: 1.1 },
  nightSurcharge: 0.2, weekendSurcharge: 0.1, peakSurcharge: 0.15,
  luggageFee: 3, includedLuggage: 2, waitingPerMinute: 0.5,
  partnerMultiplier: 1, commissionRate: 0.2,
};
export const DEFAULT_FLAT_RATES: FlatRate[] = [
  { id: "cdg-paris", fromZone: "CDG", toZone: "PARIS", bidirectional: true, prices: { BERLINE: 55, BUSINESS: 75, VAN: 85, GREEN: 60 } },
  { id: "orly-paris", fromZone: "ORLY", toZone: "PARIS", bidirectional: true, prices: { BERLINE: 45, BUSINESS: 65, VAN: 75, GREEN: 50 } },
];
export const QUOTE_TTL_MIN = 15;

/** Cherche le forfait le plus précis : une adresse près de la Gare du Nord retombe sur « PARIS » si aucun forfait gare n'existe. */
export function matchZones(from: string[], to: string[], flat: FlatRate[], category: VehicleCategory) {
  for (const f of from) for (const t of to) {
    if (findFlatRate(flat, f, t)?.prices[category] !== undefined) return { fromZone: f, toZone: t };
  }
  return { fromZone: from[0], toZone: to[0] };
}

/** Estimation provisoire (à vol d'oiseau). Brancher OSRM/Google ici sans toucher au reste. */
export class RoutingService {
  estimate(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const distanceKm = haversineKm(a, b) * 1.3;
    return { distanceKm, durationMin: Math.max(5, (distanceKm / 35) * 60) };
  }
}

@Injectable()
export class QuotesService {
  private routing = new RoutingService();
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private async loadConfig(): Promise<{ cfg: PricingConfig; flat: FlatRate[] }> {
    const [rules, flats] = await Promise.all([
      this.prisma.pricingRuleSet.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } }),
      this.prisma.flatRate.findMany(),
    ]);
    return {
      cfg: rules ? { ...DEFAULT_PRICING, ...(rules.config as object) } : DEFAULT_PRICING,
      flat: flats.length
        ? flats.map((f) => ({ id: f.id, fromZone: f.fromZone, toZone: f.toZone, bidirectional: f.bidirectional, prices: f.prices as any }))
        : DEFAULT_FLAT_RATES,
    };
  }

  async create(partner: Partner, req: QuoteRequest) {
    const pickupAt = new Date(req.pickupAt);
    if (pickupAt.getTime() <= Date.now()) throw new HttpException({ errors: { pickupAt: ["doit être dans le futur"] } }, 422);

    const { cfg, flat } = await this.loadConfig();
    const { distanceKm, durationMin } = this.routing.estimate(req.pickup, req.dropoff);
    const q = computeQuote(
      {
        distanceKm, durationMin, category: req.category, pickupAt, luggage: req.luggage,
        ...matchZones(zonesOf(req.pickup), zonesOf(req.dropoff), flat, req.category),
      },
      { ...cfg, partnerMultiplier: Number(partner.priceMultiplier), commissionRate: Number(partner.commissionRate) },
      flat,
    );
    const priceCents = cents(q.total);
    const commissionCents = cents(q.commission);
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MIN * 60_000);
    const saved = await this.prisma.quote.create({
      data: {
        partnerId: partner.id, request: req as any, category: req.category, pickupAt,
        distanceKm, durationMin, priceCents, commissionCents,
        driverNetCents: priceCents - commissionCents, flatRateId: q.flatRateId, expiresAt,
      },
    });
    return {
      quoteId: saved.id,
      total: euros(priceCents),
      currency: "EUR",
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMin: Math.round(durationMin),
      flatRate: Boolean(q.flatRateId),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
