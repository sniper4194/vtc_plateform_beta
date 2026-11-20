/**
 * Crée (ou promeut) un administrateur du back-office.
 *   ADMIN_PASSWORD='phrase de passe longue' pnpm -F @vtc/api admin:create vous@exemple.fr "Votre Nom"
 * Le mot de passe se passe par variable d'environnement (jamais en argument : il apparaîtrait dans l'historique du shell).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordProblem } from "../src/passwords";

async function main() {
  const [emailRaw, name] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!emailRaw || !name || !password) {
    console.error("Usage : ADMIN_PASSWORD=... create-admin <email> <nom>");
    process.exit(2);
  }
  const email = emailRaw.trim().toLowerCase();
  const problem = passwordProblem(password, email);
  if (problem) { console.error(problem); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const u = await prisma.adminUser.upsert({
      where: { email },
      create: { email, name, role: "ADMIN", passwordHash },
      update: { name, role: "ADMIN", passwordHash, active: true, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
    });
    console.log(`Administrateur prêt : ${u.email}`);
  } finally { await prisma.$disconnect(); }
}
main();
