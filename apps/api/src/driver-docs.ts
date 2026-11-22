import { PrismaService } from "./prisma";
import { VEHICLE_RULES } from "./vehicle-rules";

export const REQUIRED_DOCS = ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"] as const;

/** Avec le contrôle du véhicule actif, la carte grise (date de mise en circulation) et le contrôle technique (annuel pour un VTC, d'après la source consultée) deviennent obligatoires. */
export const requiredDocs = (): string[] => [...REQUIRED_DOCS, ...(VEHICLE_RULES.enabled ? ["REGISTRATION_CERT", "TECHNICAL_INSPECTION"] : [])];

/** Documents obligatoires manquants ou expirés pour un chauffeur. */
export async function missingDocuments(prisma: PrismaService, driverId: string): Promise<string[]> {
  const docs = await prisma.document.findMany({ where: { driverId, status: "APPROVED" } });
  const now = new Date();
  // Le contrôle technique doit porter une date d'échéance : sans elle, on ne peut pas savoir s'il est encore valable.
  const valid = new Set(docs.filter((d) => (d.type === "TECHNICAL_INSPECTION" ? !!d.expiresAt && d.expiresAt > now : !d.expiresAt || d.expiresAt > now)).map((d) => d.type as string));
  return requiredDocs().filter((t) => !valid.has(t));
}
