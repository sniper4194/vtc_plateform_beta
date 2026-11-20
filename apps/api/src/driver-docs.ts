import { PrismaService } from "./prisma";

export const REQUIRED_DOCS = ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"] as const;

/** Documents obligatoires manquants ou expirés pour un chauffeur. */
export async function missingDocuments(prisma: PrismaService, driverId: string): Promise<string[]> {
  const docs = await prisma.document.findMany({ where: { driverId, status: "APPROVED" } });
  const now = new Date();
  const valid = new Set(docs.filter((d) => !d.expiresAt || d.expiresAt > now).map((d) => d.type as string));
  return REQUIRED_DOCS.filter((t) => !valid.has(t));
}
