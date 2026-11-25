import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { parseTheme, parseThemeStyle, type ThemeMode, type ThemeStyle } from "./theme";

const MODE_KEY = "theme_mode";
const STYLE_KEY = "theme_style";

async function read(key: string) {
  try {
    return Platform.OS === "web" ? globalThis.localStorage?.getItem(key) : await SecureStore.getItemAsync(key);
  } catch { return null; }
}

async function write(key: string, value: string) {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch { /* préférence non critique */ }
}

export async function loadThemeMode(): Promise<ThemeMode> {
  return parseTheme(await read(MODE_KEY));
}

export async function loadThemeStyle(): Promise<ThemeStyle | null> {
  return parseThemeStyle(await read(STYLE_KEY));
}

export const saveThemeMode = (mode: ThemeMode) => write(MODE_KEY, mode);
export const saveThemeStyle = (style: ThemeStyle) => write(STYLE_KEY, style);
