import "@fontsource/rozha-one/400.css";
import "@fontsource/alfa-slab-one/400.css";
import "@fontsource/anton/400.css";
import "@fontsource/kaushan-script/400.css";
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "CliCab · Tour de contrôle" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning>{process.env.NEXT_PUBLIC_API_URL === "https://api-test.clicab.fr" && <div role="status" style={{background:"#f7b30a",color:"#14172b",textAlign:"center",fontWeight:700,padding:8}}>CLICAB TEST — PRÉPRODUCTION — DONNÉES FICTIVES</div>}{children}</body>
    </html>
  );
}
