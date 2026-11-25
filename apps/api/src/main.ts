import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { securityHeaders } from "./hardening";
import { checkStagingEnv } from "./staging";

export function checkEnv(env = process.env) {
  checkStagingEnv(env);
  if (env.NODE_ENV === "production") {
    // ADMIN_TOKEN (token de service pour scripts) est optionnel ; s'il est défini, il doit être robuste.
    if (env.CORS_ORIGINS?.split(",").map((o) => o.trim()).includes("*")) throw new Error("CORS_ORIGINS=* (toutes les origines) est interdit en production");
    if (env.DRIVER_DEV_OTP) throw new Error("DRIVER_DEV_OTP (code de développement) est interdit en production");
    if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length < 24) throw new Error("ADMIN_TOKEN doit faire au moins 24 caractères");
    if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) throw new Error("TOKEN_SECRET (≥ 32 caractères) requis en production");
  }
}

async function bootstrap() {
  checkEnv();
  // CORS_ORIGINS=* (toutes les origines) : démonstration locale seulement, refusé en production.
  const origins = process.env.CORS_ORIGINS?.split(",").map((o) => o.trim());
  const app = await NestFactory.create(AppModule, { cors: { origin: origins?.includes("*") ? true : origins ?? false } });
  // Derrière un proxy/répartiteur : TRUST_PROXY=1 pour que req.ip soit l'IP réelle du client (limitation des connexions).
  if (process.env.TRUST_PROXY) (app as any).set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  // Les selfies de vérification d'identité sont envoyés en base64 (400 Ko max décodés) : la limite par défaut (100 Ko) est trop basse.
  (app as any).useBodyParser("json", { limit: "1mb" });
  (app as any).disable?.("x-powered-by"); // ne pas annoncer la technologie du serveur
  app.use(securityHeaders());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
