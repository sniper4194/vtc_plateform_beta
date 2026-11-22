// Crée les fichiers .env à partir de .env.example (Windows, Mac, Linux) sans écraser ceux qui existent déjà.
// Prisma lit le fichier .env du dossier apps/api : sans lui, « Environment variable not found: DATABASE_URL ».
import { copyFileSync, existsSync } from "node:fs";

for (const dest of [".env", "apps/api/.env"]) {
  if (existsSync(dest)) console.log(`déjà présent : ${dest}`);
  else { copyFileSync(".env.example", dest); console.log(`créé : ${dest}`); }
}
