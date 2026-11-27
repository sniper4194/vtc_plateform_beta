import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

/**
 * Partage de la position pendant une mission, même application en arrière-plan (choix de l'utilisateur).
 * Android affiche une notification permanente tant que le partage tourne. Le serveur répond « live: false » quand
 * plus aucune mission n'est en route / sur place / à bord : le partage s'arrête alors de lui-même.
 * La session biométrique ne peut pas être déverrouillée hors de l'application : une copie de la session est gardée
 * pour la seule durée du partage, puis effacée.
 */
export const LIVE_TASK = "clicab-live-location";
const TOKEN_KEY = "live_location_token";
const URL_KEY = "live_location_url";
const supported = Platform.OS === "android" || Platform.OS === "ios";

async function forget() {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}), SecureStore.deleteItemAsync(URL_KEY).catch(() => {})]);
}

export async function stopLiveTracking() {
  if (!supported) return;
  try { if (await Location.hasStartedLocationUpdatesAsync(LIVE_TASK)) await Location.stopLocationUpdatesAsync(LIVE_TASK); } catch { /* déjà arrêté */ }
  await forget();
}

if (supported) {
  TaskManager.defineTask(LIVE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const loc = (data as { locations?: Location.LocationObject[] }).locations?.slice(-1)[0];
    if (!loc) return;
    const [token, url] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(URL_KEY)]);
    if (!token || !url) { await stopLiveTracking(); return; }
    try {
      const res = await fetch(`${url}/driver/location`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
      });
      if (res.status === 401) { await stopLiveTracking(); return; }
      const body = await res.json().catch(() => null);
      if (body && body.live === false) await stopLiveTracking();
    } catch { /* réseau absent : le prochain point réessaiera */ }
  });
}

export async function liveTrackingRunning(): Promise<boolean> {
  if (!supported) return false;
  try { return await Location.hasStartedLocationUpdatesAsync(LIVE_TASK); } catch { return false; }
}

export async function backgroundPermissionGranted(): Promise<boolean> {
  if (!supported) return false;
  try { return (await Location.getBackgroundPermissionsAsync()).status === "granted"; } catch { return false; }
}

/** Démarre le partage. « ask » : demander l'autorisation « Toujours » si elle manque (geste explicite du chauffeur). */
export async function startLiveTracking(session: { token: string; apiUrl: string } | null, ask: boolean): Promise<"started" | "denied" | "unavailable"> {
  if (!supported || !session) return "unavailable";
  try {
    const fg = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return "denied";
    const bg = ask ? await Location.requestBackgroundPermissionsAsync() : await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") return "denied";
    await SecureStore.setItemAsync(TOKEN_KEY, session.token);
    await SecureStore.setItemAsync(URL_KEY, session.apiUrl);
    if (!(await Location.hasStartedLocationUpdatesAsync(LIVE_TASK))) {
      await Location.startLocationUpdatesAsync(LIVE_TASK, {
        accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 30,
        pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "CliCab : mission en cours",
          notificationBody: "Votre position est partagée avec la tour de contrôle et le voyageur jusqu'à la fin de la mission.",
        },
      });
    }
    return "started";
  } catch {
    return "unavailable";
  }
}
