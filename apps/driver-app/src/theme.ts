/** Identité visuelle : aplats bleu / jaune / rouge, serif massif, pastilles. Nom de marque provisoire : une seule constante. */
export const BRAND = process.env.EXPO_PUBLIC_CLICAB_TEST === "1" ? "CliCab TEST" : "CliCab";

export type ThemeMode = "light" | "dark";

/** Seuls les tons « fond d'écran » changent : les cartes restent crème (texte encre dessus), comme du papier posé sur un bureau sombre. */
export const PALETTES: Record<ThemeMode, { sky: string; onSky: string }> = {
  light: { sky: "#96d3ed", onSky: "#19172a" }, // fond bleu ciel + texte bleu nuit posé dessus (contraste 8,7)
  dark: { sky: "#0e1a2d", onSky: "#f5eedd" }, // fond bleu nuit + texte crème (contraste 14)
};

/** Objet muable : les écrans lisent `c.xxx` à chaque rendu ; après `applyTheme`, l'application se remonte pour tout repeindre. */
export const c = {
  ...PALETTES.light,
  blue: "#1a66c2", dblue: "#0f4a96", // bleu soutenu : boutons, pastilles, accents (texte crème dessus : contraste 4,9)
  red: "#dc2626", yel: "#ffbc00", org: "#f59a0c",
  cream: "#f4efdc", ink: "#19172a", white: "#ffffff", muted: "#5b5f7a", ok: "#0a8f5b",
};

export const font = {
  display: "RozhaOne_400Regular",
  slab: "AlfaSlabOne_400Regular",
  cond: "Anton_400Regular",
  script: "KaushanScript_400Regular",
};

export function applyTheme(mode: ThemeMode) {
  Object.assign(c, PALETTES[mode]);
}
export const parseTheme = (v: unknown): ThemeMode => (v === "dark" ? "dark" : "light");
