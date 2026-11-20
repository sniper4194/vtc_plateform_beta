/** Données de configuration initiales : règles de prix et forfaits (idempotent). */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_FLAT_RATES, DEFAULT_PRICING } from "../src/quotes.service";

const prisma = new PrismaClient();
async function main() {
  if (!(await prisma.pricingRuleSet.count())) {
    await prisma.pricingRuleSet.create({ data: { name: "Grille par défaut", config: DEFAULT_PRICING as any } });
  }
  if (!(await prisma.flatRate.count())) {
    for (const f of DEFAULT_FLAT_RATES) {
      await prisma.flatRate.create({ data: { fromZone: f.fromZone, toZone: f.toZone, bidirectional: !!f.bidirectional, prices: f.prices as any } });
    }
  }
  console.log("seed OK");
}
main().finally(() => prisma.$disconnect());
