import { PrismaService } from "./prisma";
import { VEHICLE_RULES } from "./vehicle-rules";

export const REQUIRED_DOCS = ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"] as const;

/** Avec le contrôle du véhicule actif, la carte grise (date de mise en circulation) et le contrôle technique (annuel pour un VTC, d'après la source consultée) deviennent obligatoires. */
export const requiredDocs = (): string[] => [
  ...REQUIRED_DOCS,
  ...(VEHICLE_RULES.enabled ? ["REGISTRATION_CERT", "TECHNICAL_INSPECTION"] : []),
  ...(airportBadgeRequired() ? ["AIRPORT_BADGE"] : []),
];

/**
 * Badge d'accès aéroport, justifié par la facture de parking Aéroports de Paris : obligatoire à la demande de l'utilisateur
 * (exigence métier, base légale non vérifiée). AIRPORT_BADGE_REQUIRED=0 le rend facultatif. Lu à chaque appel.
 */
export const airportBadgeRequired = () => process.env.AIRPORT_BADGE_REQUIRED !== "0";

/**
 * Identité d'exploitant manquante. Un chauffeur de VTC doit pouvoir justifier (registre des exploitants, REVTC) de qui exploite la course :
 * lui-même (entreprise individuelle ou société) ou la société qui l'emploie. On exige aussi le numéro de sa carte professionnelle.
 */
export async function missingIdentifiers(prisma: PrismaService, driverId: string): Promise<string[]> {
  if (!VEHICLE_RULES.enabled) return [];
  const d = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, include: { company: true } });
  const out: string[] = [];
  if (!d.proCardNumber) out.push("numéro de carte professionnelle VTC");
  const siret = d.company ? d.company.siret : d.siret;
  const revtc = d.company ? d.company.vtcRegistry : d.revtcNumber;
  if (!siret) out.push(d.company ? "Siret de la société de rattachement" : "numéro Siren/Siret");
  if (!revtc) out.push(d.company ? "inscription de la société au registre des exploitants de VTC" : "numéro d'inscription au registre des exploitants de VTC");
  return out;
}

/** Documents obligatoires manquants ou expirés pour un chauffeur. */
export async function missingDocuments(prisma: PrismaService, driverId: string): Promise<string[]> {
  const docs = await prisma.document.findMany({ where: { driverId, status: "APPROVED" } });
  const now = new Date();
  // Le contrôle technique doit porter une date d'échéance : sans elle, on ne peut pas savoir s'il est encore valable.
  const valid = new Set(docs.filter((d) => (d.type === "TECHNICAL_INSPECTION" ? !!d.expiresAt && d.expiresAt > now : !d.expiresAt || d.expiresAt > now)).map((d) => d.type as string));
  return requiredDocs().filter((t) => !valid.has(t));
}
