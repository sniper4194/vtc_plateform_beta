export type VehicleCategory = "BERLINE" | "BUSINESS" | "VAN" | "GREEN";

export interface PricingConfig {
  /** Prix de base (€) */
  baseFare: number;
  perKm: number;
  perMinute: number;
  minFare: number;
  categoryMultiplier: Record<VehicleCategory, number>;
  /** Majorations en fraction (0.2 = +20 %) */
  nightSurcharge: number; // 22h-6h
  weekendSurcharge: number; // samedi/dimanche
  peakSurcharge: number; // appliqué si peak = true
  luggageFee: number; // par bagage au-delà de includedLuggage
  includedLuggage: number;
  waitingPerMinute: number;
  /** Coefficient négocié par partenaire (1 = tarif public) */
  partnerMultiplier: number;
  /** Commission plateforme en fraction du prix */
  commissionRate: number;
  /**
   * Ajustement de la commission par catégorie, en points de commission (-0.05 : 5 points de moins). S'ajoute au taux de base,
   * y compris au taux négocié d'un partenaire. Sert à mieux rémunérer les chauffeurs de van.
   */
  categoryCommissionAdjust?: Partial<Record<VehicleCategory, number>>;
}

/** Taux de commission applicable à une catégorie : taux de base + ajustement, borné entre 0 et 90 %. */
export function commissionRateFor(config: Pick<PricingConfig, "commissionRate" | "categoryCommissionAdjust">, category: VehicleCategory): number {
  const rate = config.commissionRate + (config.categoryCommissionAdjust?.[category] ?? 0);
  return Math.min(0.9, Math.max(0, rate));
}

export interface FlatRate {
  id: string;
  /** Zones de départ / d'arrivée (ex. "CDG", "PARIS") */
  fromZone: string;
  toZone: string;
  /** Prix fixe par catégorie (€) */
  prices: Partial<Record<VehicleCategory, number>>;
  bidirectional?: boolean;
}

export interface QuoteInput {
  distanceKm: number;
  durationMin: number;
  category: VehicleCategory;
  /** Date de prise en charge (UTC) */
  pickupAt: Date;
  /** Fuseau d'affichage pour déterminer nuit/week-end */
  timeZone?: string;
  fromZone?: string;
  toZone?: string;
  luggage?: number;
  peak?: boolean;
  waitingMinutes?: number;
}

export interface Quote {
  total: number; // prix client TTC (€)
  driverNet: number; // net chauffeur
  commission: number;
  flatRateId?: string;
  breakdown: Record<string, number>;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function localParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const weekday = parts.find((p) => p.type === "weekday")!.value;
  return { hour, weekend: weekday === "Sat" || weekday === "Sun" };
}

export function findFlatRate(
  rates: FlatRate[],
  from?: string,
  to?: string,
): FlatRate | undefined {
  if (!from || !to) return undefined;
  return rates.find(
    (r) =>
      (r.fromZone === from && r.toZone === to) ||
      (r.bidirectional && r.fromZone === to && r.toZone === from),
  );
}

export function computeQuote(
  input: QuoteInput,
  config: PricingConfig,
  flatRates: FlatRate[] = [],
): Quote {
  if (input.distanceKm < 0 || input.durationMin < 0) {
    throw new RangeError("distance et durée doivent être positives");
  }
  const tz = input.timeZone ?? "Europe/Paris";
  const breakdown: Record<string, number> = {};

  const flat = findFlatRate(flatRates, input.fromZone, input.toZone);
  const flatPrice = flat?.prices[input.category];

  let base: number;
  let flatRateId: string | undefined;
  if (flatPrice !== undefined) {
    base = flatPrice;
    flatRateId = flat!.id;
    breakdown.flatRate = flatPrice;
  } else {
    const metered =
      config.baseFare +
      input.distanceKm * config.perKm +
      input.durationMin * config.perMinute;
    const withMin = Math.max(metered, config.minFare);
    base = withMin * config.categoryMultiplier[input.category];
    breakdown.metered = round2(metered);
    breakdown.minFareApplied = metered < config.minFare ? 1 : 0;
    breakdown.categoryMultiplier = config.categoryMultiplier[input.category];
  }

  // Majorations (sur base, sauf forfait : seuls bagages/attente s'ajoutent)
  let surchargeRate = 0;
  if (!flatRateId) {
    const { hour, weekend } = localParts(input.pickupAt, tz);
    if (hour >= 22 || hour < 6) {
      surchargeRate += config.nightSurcharge;
      breakdown.night = config.nightSurcharge;
    }
    if (weekend) {
      surchargeRate += config.weekendSurcharge;
      breakdown.weekend = config.weekendSurcharge;
    }
    if (input.peak) {
      surchargeRate += config.peakSurcharge;
      breakdown.peak = config.peakSurcharge;
    }
  }

  const extraLuggage = Math.max(0, (input.luggage ?? 0) - config.includedLuggage);
  const luggage = extraLuggage * config.luggageFee;
  const waiting = (input.waitingMinutes ?? 0) * config.waitingPerMinute;
  if (luggage) breakdown.luggage = round2(luggage);
  if (waiting) breakdown.waiting = round2(waiting);

  const total = round2(
    (base * (1 + surchargeRate) + luggage + waiting) * config.partnerMultiplier,
  );
  const rate = commissionRateFor(config, input.category);
  breakdown.commissionRate = rate;
  const commission = round2(total * rate);
  return {
    total,
    commission,
    driverNet: round2(total - commission),
    flatRateId,
    breakdown,
  };
}
