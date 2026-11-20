const path = require("path");

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Sortie autonome pour l'image Docker ; la racine du monorepo est tracée pour inclure les dépendances.
  output: "standalone",
  experimental: { outputFileTracingRoot: path.join(__dirname, "../../") },
};
