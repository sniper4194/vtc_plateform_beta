import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "CliCab · Suivi de votre trajet", robots: { index: false, follow: false } };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
