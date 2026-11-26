"use client";
import { useEffect, useState } from "react";
import { parseSiteTheme, THEME_KEY, type SiteTheme } from "../lib/theme";

export function ThemeSwitch() {
  const [theme, setTheme] = useState<SiteTheme>("original");
  useEffect(() => { setTheme(parseSiteTheme(document.documentElement.dataset.theme)); }, []);
  function change(next: SiteTheme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* le choix reste valable sur cette page */ }
  }
  return (
    <footer className="wrap theme-switch">
      <label>
        <span>Thème</span>
        <select aria-label="Thème d'affichage" value={theme} onChange={(e) => change(parseSiteTheme(e.target.value))}>
          <option value="original">Original</option>
          <option value="classique">Classique</option>
        </select>
      </label>
    </footer>
  );
}
