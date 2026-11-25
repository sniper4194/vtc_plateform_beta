/**
 * Photos-preuves sur place (client absent, bagages en excès). Règles pures : testables sans base de données.
 * La preuve n'est jamais refusée pour un défaut de position ou d'heure : elle est enregistrée avec des **signalements** que le
 * partenaire et l'équipe voient. Seule l'heure du serveur fait foi ; la date incrustée dans l'image vient du téléphone.
 */
export const PROOF_KINDS = ["NO_SHOW", "EXCESS_LUGGAGE", "OTHER"] as const;
export type ProofKindName = (typeof PROOF_KINDS)[number];
export const PROOF_LABEL: Record<string, string> = { NO_SHOW: "Client absent", EXCESS_LUGGAGE: "Bagages en excès", OTHER: "Autre preuve" };

/** Statuts de mission dans lesquels une preuve peut être ajoutée (sur place, en cours de course, ou juste après pour un litige). */
export const PROOF_STATUSES = ["ARRIVED", "IN_PROGRESS", "NO_SHOW", "COMPLETED"];

export function proofLimits(env: NodeJS.ProcessEnv = process.env) {
  const n = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    maxBytes: n(env.PROOF_MAX_BYTES, 650_000), // décodés ; en base64 cela reste sous la limite de 1 Mo des requêtes
    maxPerRide: n(env.PROOF_MAX_PER_RIDE, 10),
    maxDistanceM: n(env.PROOF_MAX_DISTANCE_M, 300), // au-delà : « loin du lieu de prise en charge »
    maxAccuracyM: n(env.PROOF_MAX_ACCURACY_M, 100), // au-delà : « position imprécise »
    clockToleranceSec: n(env.PROOF_CLOCK_TOLERANCE_SEC, 300), // écart toléré entre l'heure du téléphone et celle du serveur
  };
}

export const PROOF_FLAG_LABEL: Record<string, string> = {
  FAR_FROM_PICKUP: "Position éloignée du lieu de prise en charge",
  LOW_ACCURACY: "Position GPS imprécise",
  CLOCK_MISMATCH: "Heure du téléphone différente de celle du serveur",
  NO_DEVICE_TIME: "Heure du téléphone non fournie",
};

export function proofFlags(p: { distanceM: number; accuracyM?: number | null; deviceTakenAt?: Date | null; receivedAt: Date }, lim = proofLimits()): string[] {
  const flags: string[] = [];
  if (p.distanceM > lim.maxDistanceM) flags.push("FAR_FROM_PICKUP");
  if (p.accuracyM != null && p.accuracyM > lim.maxAccuracyM) flags.push("LOW_ACCURACY");
  if (!p.deviceTakenAt) flags.push("NO_DEVICE_TIME");
  else if (Math.abs(p.deviceTakenAt.getTime() - p.receivedAt.getTime()) > lim.clockToleranceSec * 1000) flags.push("CLOCK_MISMATCH");
  return flags;
}

/** Format JPEG ou PNG vérifié sur les premiers octets (on ne stocke pas n'importe quel fichier). */
export function imageMime(buf: Buffer): "image/jpeg" | "image/png" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}
