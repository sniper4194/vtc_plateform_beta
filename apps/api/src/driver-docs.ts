import { PrismaService } from "./prisma";
import { VEHICLE_RULES } from "./vehicle-rules";

export const REQUIRED_DOCS = ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"] as const;

/** Avec le contrôle du véhicule actif, la carte grise devient obligatoire (elle prouve l'année de mise en circulation). */
export const requiredDocs = (): string[] => [...REQUIRED_DOCS, ...(VEHICLE_RULES.enabled ? ["REGISTRATION_CERT"] : [])];

/** Documents obligatoires manquants ou expirés pour un chauffeur. */
export async function missingDocuments(prisma: PrismaService, driverId: string): Promise<string[]> {
  const docs = await prisma.document.findMany({ where: { driverId, status: "APPROVED" } });
  const now = new Date();
  const valid = new Set(docs.filter((d) => !d.expiresAt || d.expiresAt > now).map((d) => d.type as string));
  return requiredDocs().filter((t) => !valid.has(t));
}
