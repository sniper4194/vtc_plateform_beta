/** Deux styles au choix du visiteur : « Original » (affiche rétro CliCab, par défaut) et « Classique » (sobre). */
export type SiteTheme = "original" | "classique";
export const THEME_KEY = "clicab-theme";
export const parseSiteTheme = (v: unknown): SiteTheme => (v === "classique" ? "classique" : "original");

/** Exécuté avant l'affichage (balise <script> du layout) pour éviter un éclair du mauvais thème. */
export const themeBootScript = `try{document.documentElement.dataset.theme=localStorage.getItem(${JSON.stringify(THEME_KEY)})==="classique"?"classique":"original"}catch(e){document.documentElement.dataset.theme="original"}`;
