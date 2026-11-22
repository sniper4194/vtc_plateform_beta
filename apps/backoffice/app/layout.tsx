import "@fontsource/rozha-one/400.css";
import "@fontsource/alfa-slab-one/400.css";
import "@fontsource/anton/400.css";
import "@fontsource/kaushan-script/400.css";
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "CliCab · Tour de contrôle" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
