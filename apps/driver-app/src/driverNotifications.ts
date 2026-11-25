import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type DriverAlertKind = "offer" | "landing";

const channels = {
  offer: { id: "driver-offers", name: "Nouvelles courses", sound: "notification_course.wav" },
  landing: { id: "driver-landings", name: "Atterrissages", sound: "notification_atterrissage.wav" },
};
const supportsNotifications = () => Platform.OS === "android" || Platform.OS === "ios";
const androidPermissionAsked = "driver_notification_permission_asked";

export async function requestDriverNotifications() {
  if (!supportsNotifications()) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === "android") {
      // Android 13+ peut afficher la demande après la création d'un premier canal.
      for (const channel of Object.values(channels)) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance.HIGH,
          sound: channel.sound,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        });
      }
    }
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted || !settings.canAskAgain) return;
    if (Platform.OS === "android") {
      // Expo peut renvoyer « denied » avant la toute première demande sur Android 13+.
      if (Platform.Version < 33 || await SecureStore.getItemAsync(androidPermissionAsked)) return;
      await Notifications.requestPermissionsAsync();
      await SecureStore.setItemAsync(androidPermissionAsked, "1");
    } else if (settings.status === "undetermined") {
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
    }
  } catch {
    // Les alertes dans l'application restent disponibles si le service natif échoue.
  }
}

export async function postDriverNotification(kind: DriverAlertKind, title: string, body: string): Promise<boolean> {
  if (!supportsNotifications()) return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted && settings.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return false;
    const channel = channels[kind];
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: channel.sound },
      trigger: Platform.OS === "android" ? { channelId: channel.id } : null,
    });
    return true;
  } catch {
    return false;
  }
}
