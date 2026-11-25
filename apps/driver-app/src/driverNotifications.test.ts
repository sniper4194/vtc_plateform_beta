import { beforeEach, describe, expect, it, vi } from "vitest";
import { postDriverNotification, requestDriverNotifications } from "./driverNotifications";

const native = vi.hoisted(() => ({
  platform: { OS: "android", Version: 34 },
  setHandler: vi.fn(),
  createChannel: vi.fn(),
  getPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  getSaved: vi.fn(),
  setSaved: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: native.platform }));
vi.mock("expo-secure-store", () => ({ getItemAsync: native.getSaved, setItemAsync: native.setSaved }));
vi.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationHandler: native.setHandler,
  setNotificationChannelAsync: native.createChannel,
  getPermissionsAsync: native.getPermissions,
  requestPermissionsAsync: native.requestPermissions,
  scheduleNotificationAsync: native.schedule,
}));

beforeEach(() => {
  vi.resetAllMocks();
  native.platform.OS = "android";
  native.platform.Version = 34;
});

describe("notifications du chauffeur", () => {
  it("crée les deux canaux Android avant de demander l’autorisation au premier démarrage", async () => {
    native.getPermissions.mockResolvedValue({ status: "denied", granted: false, canAskAgain: true });
    await requestDriverNotifications();
    expect(native.createChannel.mock.calls.map(([id, channel]) => [id, channel.sound])).toEqual([
      ["driver-offers", "notification_course.wav"],
      ["driver-landings", "notification_atterrissage.wav"],
    ]);
    expect(native.createChannel.mock.invocationCallOrder[1]).toBeLessThan(native.requestPermissions.mock.invocationCallOrder[0]);
    expect(native.requestPermissions).toHaveBeenCalledOnce();
    expect(native.setSaved).toHaveBeenCalledWith("driver_notification_permission_asked", "1");
  });

  it("respecte un refus sans relancer la demande et permet le repli dans l’application", async () => {
    native.getPermissions.mockResolvedValue({ status: "denied", granted: false, canAskAgain: true });
    native.getSaved.mockResolvedValue("1");
    await requestDriverNotifications();
    expect(native.requestPermissions).not.toHaveBeenCalled();
    expect(await postDriverNotification("offer", "Nouvelle course", "Offre disponible")).toBe(false);
    expect(native.schedule).not.toHaveBeenCalled();
  });

  it("utilise le canal Android et le son correspondant à l’événement", async () => {
    native.getPermissions.mockResolvedValue({ status: "granted", granted: true });
    expect(await postDriverNotification("landing", "Vol arrivé", "Le vol est posé")).toBe(true);
    expect(native.schedule).toHaveBeenCalledWith({
      content: { title: "Vol arrivé", body: "Le vol est posé", sound: "notification_atterrissage.wav" },
      trigger: { channelId: "driver-landings" },
    });
  });

  it("publie une notification immédiate sur iOS", async () => {
    native.platform.OS = "ios";
    native.getPermissions.mockResolvedValue({ status: "granted", granted: true });
    expect(await postDriverNotification("offer", "Nouvelle course", "Offre disponible")).toBe(true);
    expect(native.schedule).toHaveBeenCalledWith({
      content: { title: "Nouvelle course", body: "Offre disponible", sound: "notification_course.wav" },
      trigger: null,
    });
  });

  it("conserve les alertes intégrées sur le web et en cas d’échec natif", async () => {
    native.getPermissions.mockResolvedValue({ granted: true });
    native.schedule.mockRejectedValue(new Error("service indisponible"));
    expect(await postDriverNotification("offer", "Nouvelle course", "Offre disponible")).toBe(false);

    native.platform.OS = "web";
    native.getPermissions.mockClear();
    await requestDriverNotifications();
    expect(await postDriverNotification("offer", "Nouvelle course", "Offre disponible")).toBe(false);
    expect(native.getPermissions).not.toHaveBeenCalled();
  });
});
