"use client";
import { useEffect, useState } from "react";

/** Deux styles au choix de chaque utilisateur : « Original » (affiche rétro, par défaut) et « Classique » (sobre). */
export type SiteTheme = "original" | "classique";
// Même clé pour la tour de contrôle et l'espace société : un seul choix par navigateur.
const THEME_KEY = "clicab-theme";

export const parseSiteTheme = (v: unknown): SiteTheme => (v === "classique" ? "classique" : "original");

export function useSiteTheme(): [SiteTheme, (next: SiteTheme) => void] {
  const [theme, setTheme] = useState<SiteTheme>("original");
  useEffect(() => {
    try { setTheme(parseSiteTheme(localStorage.getItem(THEME_KEY))); } catch { /* stockage bloqué : thème par défaut */ }
  }, []);
  const change = (next: SiteTheme) => {
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* le choix reste valable pendant la session */ }
  };
  return [theme, change];
}

export function ThemePicker({ theme, onTheme, label }: { theme: SiteTheme; onTheme: (theme: SiteTheme) => void; label: string }) {
  return (
    <label className="regulator-theme-picker">
      <span>Thème</span>
      <select aria-label={label} value={theme} onChange={(event) => onTheme(parseSiteTheme(event.target.value))}>
        <option value="original">Original</option>
        <option value="classique">Classique</option>
      </select>
    </label>
  );
}
