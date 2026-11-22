import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://vtc:vtc@localhost:5432/vtc_test?schema=public",
      ADMIN_TOKEN: "test-admin-token-test-admin-token",
      TOKEN_SECRET: "test-token-secret-test-token-secret",
      DISABLE_WORKERS: "1",
      OTP_IP_PER_MIN: "100000", LOGIN_IP_PER_MIN: "100000", // les limites par IP sont testées explicitement
      IDENTITY_CHECKS: "0", // les tests de parcours se mettent en ligne sans selfie ; le contrôle est testé explicitement
      VEHICLE_RULES: "0", // les tests de parcours créent des véhicules sans caractéristiques ; le contrôle est testé explicitement
      PRICE_LADDER: "0", // les tests de parcours supposent un prix stable ; l'échelle est testée explicitement
      DRIVER_DEV_OTP: "000000", // les tests de parcours se connectent avec le code de dév ; les tests OTP le retirent
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
