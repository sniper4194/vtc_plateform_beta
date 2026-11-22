import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Étoile · Suivi de votre trajet", robots: { index: false, follow: false } };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
