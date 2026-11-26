/** Identité visuelle CliCab. Le style (Original / Classique) et le mode clair/sombre sont deux préférences indépendantes. */
export const BRAND = process.env.EXPO_PUBLIC_CLICAB_TEST === "1" ? "CliCab TEST" : "CliCab";

export type ThemeMode = "light" | "dark";
export type ThemeStyle = "original" | "classic";

export const PALETTES: Record<ThemeMode, { sky: string; onSky: string }> = {
  light: { sky: "#96d3ed", onSky: "#19172a" }, // fond bleu ciel + texte encre posé dessus
  dark: { sky: "#0e1a2d", onSky: "#f5eedd" }, // fond bleu nuit + texte crème (contraste 14)
};

/** Style « Original » : l'affiche rétro (couleurs retouchées en préproduction, validées par l'utilisateur). */
const original = {
  blue: "#1a66c2", dblue: "#0f4a96", // bleu soutenu : boutons, pastilles, accents (texte crème dessus : contraste 4,9)
  red: "#dc2626", yel: "#ffbc00", org: "#f59a0c",
  cream: "#f4efdc", ink: "#19172a", white: "#ffffff", muted: "#5b5f7a", ok: "#0a8f5b",
  line: "#19172a", frame: "#0b2a4a",
};

const classic = {
  blue: "#1552a0", dblue: "#153e74",
  red: "#b52833", yel: "#f9ae00", org: "#eb941c",
  cream: "#fdf7e8", ink: "#142239", white: "#ffffff", muted: "#505d6c", ok: "#15734a",
  line: "#c8cbd0", frame: "#151827",
};

/** Les écrans lisent la palette active à chaque rendu. */
export const c = { ...PALETTES.light, ...original };
export let currentStyle: ThemeStyle = "original";

const originalFonts = {
  display: "RozhaOne_400Regular",
  slab: "AlfaSlabOne_400Regular",
  cond: "Anton_400Regular",
  script: "KaushanScript_400Regular",
};
export const font: Record<keyof typeof originalFonts, string | undefined> = { ...originalFonts };

export function applyTheme(mode: ThemeMode, style: ThemeStyle = "original") {
  currentStyle = style;
  const background = style === "classic"
    ? mode === "dark" ? { sky: classic.frame, onSky: classic.cream } : { sky: "#f1ede5", onSky: classic.ink }
    : PALETTES[mode];
  Object.assign(c, style === "classic" ? classic : original, background);
  Object.assign(font, style === "classic"
    ? { display: undefined, slab: undefined, cond: undefined, script: undefined }
    : originalFonts);
}
export const parseTheme = (v: unknown): ThemeMode => (v === "dark" ? "dark" : "light");
export const parseThemeStyle = (v: unknown): ThemeStyle | null => v === "original" || v === "classic" ? v : null;
