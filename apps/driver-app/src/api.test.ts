import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";
import { api, biometricAvailable, clearSession, loadToken, saveHybridToken, unlockBiometric } from "./api";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-secure-store", () => ({
  canUseBiometricAuthentication: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const fetchMock = vi.fn();
const protectedOptions = expect.objectContaining({
  requireAuthentication: true,
  keychainService: "clicab_biometric",
});

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(SecureStore.canUseBiometricAuthentication).mockReturnValue(true);
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  fetchMock.mockImplementation(async () => new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetchMock);
  await loadToken();
});

afterEach(() => vi.unstubAllGlobals());

describe("session biométrique Android", () => {
  it("refuse la protection si Android ne signale aucun enrôlement compatible", async () => {
    vi.mocked(SecureStore.canUseBiometricAuthentication).mockReturnValue(false);
    expect(biometricAvailable()).toBe(false);
    await expect(saveHybridToken("nouveau", true)).rejects.toThrow(/Configurez une empreinte/);
    await expect(unlockBiometric()).rejects.toThrow(/Configurez une empreinte/);
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it.each([
    ["User canceled the authentication", /annulée/],
    ["Could not authenticate the user", /Impossible de protéger/],
  ])("garde le coffre existant et traduit un échec d’écriture (%s)", async (nativeMessage, expected) => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error(nativeMessage));
    await expect(saveHybridToken("nouveau", true)).rejects.toThrow(expected);
    expect(vi.mocked(SecureStore.setItemAsync).mock.calls).toEqual([["driver_bio_v1", "nouveau", protectedOptions]]);
    expect(vi.mocked(SecureStore.deleteItemAsync).mock.calls).toEqual([["driver_token"]]);
    await api("/driver/auth/session");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it("ouvre une session classique distincte en mémoire et conserve le jeton protégé", async () => {
    await saveHybridToken("classique", false);
    await api("/driver/auth/session");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer classique");
    await clearSession();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(vi.mocked(SecureStore.deleteItemAsync).mock.calls).toEqual([["driver_token"], ["driver_token"]]);
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("protégé");
    await expect(unlockBiometric()).resolves.toBe(true);
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer protégé");
  });

  it("conserve le jeton protégé après annulation du déverrouillage", async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("User canceled the authentication"));
    await expect(unlockBiometric()).rejects.toThrow(/annulée/);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse le jeton révoqué même si la suppression locale échoue", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("révoqué");
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error("Delete failed"));
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(unlockBiometric()).rejects.toThrow(/expiré ou a été révoquée/);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("driver_bio_v1", protectedOptions);
    await api("/driver/auth/session");
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBeUndefined();
  });
});
