import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { parseTheme, type ThemeMode } from "./theme";

const KEY = "theme_mode";

/** Préférence d'affichage, conservée sur l'appareil (localStorage sur le web, SecureStore sur mobile). */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    return parseTheme(Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY));
  } catch { return "light"; }
}
export async function saveThemeMode(m: ThemeMode) {
  try { if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, m); else await SecureStore.setItemAsync(KEY, m); } catch { /* préférence non critique */ }
}
