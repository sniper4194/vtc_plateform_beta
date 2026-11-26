import "@fontsource/rozha-one/400.css";
import "@fontsource/alfa-slab-one/400.css";
import "@fontsource/anton/400.css";
import "@fontsource/kaushan-script/400.css";
import "./globals.css";
import "./theme-original.css";
import type { ReactNode } from "react";
import { themeBootScript } from "../lib/theme";
import { ThemeSwitch } from "./ThemeSwitch";

export const metadata = { title: "CliCab · Suivi de votre trajet", robots: { index: false, follow: false } };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" data-theme="original" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head>
      <body suppressHydrationWarning>{children}<ThemeSwitch /></body>
    </html>
  );
}
