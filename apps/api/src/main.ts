import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

export function checkEnv(env = process.env) {
  if (env.NODE_ENV === "production") {
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) throw new Error("ADMIN_TOKEN (≥ 24 caractères) requis en production");
    if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) throw new Error("TOKEN_SECRET (≥ 32 caractères) requis en production");
  }
}

async function bootstrap() {
  checkEnv();
  const app = await NestFactory.create(AppModule, { cors: { origin: process.env.CORS_ORIGINS?.split(",") ?? false } });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
