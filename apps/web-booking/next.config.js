const path = require("path");

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Page de suivi : le lien contient un jeton secret, il ne doit pas fuiter par l'en-tête Referer ni être indexé.
  async headers() {
    return [{ source: "/suivi/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] }];
  },
};
