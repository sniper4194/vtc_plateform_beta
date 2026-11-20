import "reflect-metadata";
import { Body, Controller, Get, HttpException, Module, Post } from "@nestjs/common";
import { computeQuote, PricingConfig, FlatRate } from "@vtc/pricing";
import { QuoteRequestSchema } from "@vtc/shared";

/** Config de démo ; en phase 1 elle viendra de la base (PricingRuleSet). */
export const DEFAULT_PRICING: PricingConfig = {
  baseFare: 5, perKm: 1.2, perMinute: 0.4, minFare: 15,
  categoryMultiplier: { BERLINE: 1, BUSINESS: 1.3, VAN: 1.5, GREEN: 1.1 },
  nightSurcharge: 0.2, weekendSurcharge: 0.1, peakSurcharge: 0.15,
  luggageFee: 3, includedLuggage: 2, waitingPerMinute: 0.5,
  partnerMultiplier: 1, commissionRate: 0.2,
};
export const DEFAULT_FLAT_RATES: FlatRate[] = [
  { id: "cdg-paris", fromZone: "CDG", toZone: "PARIS", bidirectional: true, prices: { BERLINE: 55, VAN: 85 } },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

@Controller()
export class AppController {
  @Get("health")
  health() {
    return { status: "ok" };
  }

  /** Devis provisoire : distance à vol d'oiseau ×1.3 ; remplacé par un vrai routage en phase 1. */
  @Post("v1/quotes")
  quote(@Body() body: unknown) {
    const parsed = QuoteRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ errors: parsed.error.flatten() }, 422);
    const r = parsed.data;
    const distanceKm = haversineKm(r.pickup, r.dropoff) * 1.3;
    const durationMin = (distanceKm / 35) * 60;
    const q = computeQuote(
      { distanceKm, durationMin, category: r.category, pickupAt: new Date(r.pickupAt), luggage: r.luggage },
      DEFAULT_PRICING, DEFAULT_FLAT_RATES,
    );
    return { ...q, currency: "EUR", distanceKm: Math.round(distanceKm * 10) / 10, durationMin: Math.round(durationMin) };
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}
