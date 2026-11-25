// Génère infra/docker-compose.vps.yml : le modèle avec la configuration Caddy et le script de sauvegarde intégrés.
// Usage : node infra/make-vps-compose.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
// Les tabulations sont remplacées par des espaces : l'éditeur YAML de hPanel refuse un fichier qui en contient
// (« Le fichier YAML ne peut pas être traité »), même à l'intérieur d'un bloc de texte. Caddy et le shell acceptent les espaces.
const indent = (text) => text.replace(/\s+$/, "").replace(/\t/g, "  ").split("\n").map((l) => (l ? "      " + l : "")).join("\n");
// `$` doit être doublé dans un fichier compose pour ne pas être interprété ; ici ce sont des variables de Caddy / du shell.
const literal = (text) => text.replace(/\$/g, "$$$$");
const out = readFileSync(join(dir, "docker-compose.vps.template.yml"), "utf8")
  .replace("__CADDYFILE__", () => indent(literal(readFileSync(join(dir, "Caddyfile.vps"), "utf8"))))
  .replace("__BACKUP__", () => indent(literal(readFileSync(join(dir, "backup.sh"), "utf8"))))
  .replace("__CHECK__", () => indent(literal(readFileSync(join(dir, "backup-check.sh"), "utf8"))))
  .replace("__RESTORE__", () => indent(literal(readFileSync(join(dir, "restore-drill.sh"), "utf8"))));
if (/\t/.test(out)) throw new Error("tabulation restante dans le fichier généré (refusée par hPanel)");
writeFileSync(join(dir, "docker-compose.vps.yml"), out);
console.log("infra/docker-compose.vps.yml écrit");
