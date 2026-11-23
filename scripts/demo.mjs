// Lance toute la démonstration en local avec UNE commande :  pnpm demo
// API (3000), application chauffeur dans le navigateur (8081), back-office (3001), page de suivi voyageur (3002),
// puis crée le chauffeur de démonstration et un compte administrateur. Ctrl+C arrête tout.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import net from "node:net";

const win = process.platform === "win32";
const API = "http://localhost:3000";
const ADMIN_EMAIL = "demo@clicab.local";
const ADMIN_PASSWORD = "demo-clicab-2026!";
const say = (m) => console.log(m);

const inUse = (port) => new Promise((ok) => {
  const s = net.createConnection({ port, host: "127.0.0.1" });
  s.on("connect", () => { s.destroy(); ok(true); });
  s.on("error", () => ok(false));
});

// 1. Fichiers .env
for (const dest of [".env", "apps/api/.env"]) if (!existsSync(dest)) { copyFileSync(".env.example", dest); say(`créé : ${dest}`); }
writeFileSync("apps/driver-app/.env", `EXPO_PUBLIC_API_URL=${API}\n`);

// 2. Base de données et ports libres
if (!(await inUse(5432))) {
  console.error("\n✗ La base de données ne répond pas (port 5432).\n  Ouvrez Docker Desktop, attendez qu'il soit prêt, puis lancez :  pnpm db:up\n  (ou démarrez votre PostgreSQL), puis relancez :  pnpm demo");
  process.exit(1);
}
for (const p of [3000, 3001, 3002, 8081]) {
  if (await inUse(p)) {
    console.error(`\n✗ Le port ${p} est déjà utilisé (un ancien lancement tourne encore ?).\n  Fermez-le :  taskkill /F /IM node.exe   (Windows)   puis relancez :  pnpm demo`);
    process.exit(1);
  }
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", shell: win, ...opts });

// 3. Préparation (rapide si déjà fait)
say("\n▶ Préparation : paquets partagés, migrations, données de base…");
for (const [c, a] of [["pnpm", ["setup:build"]], ["pnpm", ["-F", "@vtc/api", "db:deploy"]], ["pnpm", ["-F", "@vtc/api", "seed"]]]) {
  const r = run(c, a);
  if (r.status !== 0) { console.error(`\n✗ Échec de « ${c} ${a.join(" ")} ». Copiez le message ci-dessus pour obtenir de l'aide.`); process.exit(1); }
}

// 4. Services
const kids = [];
const start = (name, args, env = {}) => {
  const p = spawn("pnpm", args, { shell: win, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const out = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", out); p.stderr.on("data", out);
  p.on("exit", (code) => { if (!stopping) console.log(`[${name}] arrêté (code ${code}). Si c'est inattendu, copiez les lignes ci-dessus.`); });
  kids.push(p);
};
let stopping = false;
const stop = () => {
  stopping = true;
  for (const k of kids) { try { if (win) spawnSync("taskkill", ["/pid", String(k.pid), "/T", "/F"]); else process.kill(-k.pid); } catch { try { k.kill(); } catch { /* déjà arrêté */ } } }
  process.exit(0);
};
process.on("SIGINT", stop); process.on("SIGTERM", stop);

say("\n▶ Démarrage de l'API…");
start("api", ["-F", "@vtc/api", "dev:demo"]);
const up = async (url, secs) => { for (let i = 0; i < secs; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* pas encore prêt */ } await new Promise((r) => setTimeout(r, 1000)); } return false; };
if (!(await up(`${API}/health`, 90))) { console.error("\n✗ L'API ne répond pas après 90 s. Regardez les lignes [api] ci-dessus (erreur de base de données ?)."); stop(); }

say("\n▶ Création du chauffeur de démonstration et du compte administrateur…");
const dd = spawnSync("pnpm", ["-F", "@vtc/api", "demo:driver"], { shell: win, encoding: "utf8" });
process.stdout.write(dd.stdout ?? ""); process.stderr.write(dd.stderr ?? "");
const links = (dd.stdout ?? "").match(/http:\/\/localhost:3002\/suivi\/\S+/g) ?? [];
run("pnpm", ["-F", "@vtc/api", "admin:create", ADMIN_EMAIL, "Démo"], { env: { ...process.env, ADMIN_PASSWORD } });

start("app", ["-F", "@vtc/driver-app", "exec", "expo", "start", "--web", "--port", "8081", "--clear"], { CI: "1", EXPO_NO_TELEMETRY: "1" });
start("backoffice", ["-F", "@vtc/backoffice", "dev"]);
start("suivi", ["-F", "@vtc/web-booking", "dev"], { NEXT_PUBLIC_API_URL: API });

await up("http://localhost:8081", 120);
say(`
══════════════════════════════════════════════════════════════
 CliCab, démonstration prête (laissez cette fenêtre ouverte)

 Application chauffeur : http://localhost:8081
     téléphone 06 00 00 00 01   code 000000
 Back-office           : http://localhost:3001
     e-mail ${ADMIN_EMAIL}   mot de passe ${ADMIN_PASSWORD}
 Page de suivi voyageur: ${links.length ? links.join("\n                         ") : "(aucun lien affiché plus haut)"}
 API                   : ${API}/health

 Ctrl+C pour tout arrêter.
══════════════════════════════════════════════════════════════`);
