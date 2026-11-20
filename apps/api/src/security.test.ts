import { describe, expect, it } from "vitest";
import { checkEnv } from "./main";
import { generateApiKey, sha256, signToken, signWebhook, verifyToken } from "./security";

describe("security", () => {
  it("génère des clés uniques dont seul le hash est conservé", () => {
    const a = generateApiKey(true), b = generateApiKey(true);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(sha256(a.key));
    expect(a.key.startsWith("vtc_test_")).toBe(true);
  });
  it("signe et vérifie un token, refuse falsification et expiration", () => {
    const t = signToken({ sub: "x", role: "driver" }, "s", 60);
    expect(verifyToken(t, "s")?.sub).toBe("x");
    expect(verifyToken(t, "autre")).toBeNull();
    expect(verifyToken(t.slice(0, -2) + "xx", "s")).toBeNull();
    expect(verifyToken(signToken({ sub: "x" }, "s", -10), "s")).toBeNull();
  });
  it("signature webhook déterministe et sensible au contenu", () => {
    expect(signWebhook("k", "{}", 1)).toBe(signWebhook("k", "{}", 1));
    expect(signWebhook("k", "{}", 1)).not.toBe(signWebhook("k", "{ }", 1));
  });
  it("refuse de démarrer en production sans secrets", () => {
    expect(() => checkEnv({ NODE_ENV: "production" } as any)).toThrow();
    expect(() => checkEnv({ NODE_ENV: "development" } as any)).not.toThrow();
  });
});
