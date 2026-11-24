/**
 * Configuration Expo. La clé Google Maps n'est jamais écrite dans le dépôt :
 *   GOOGLE_MAPS_API_KEY=... npx expo run:android   (ou build EAS avec la variable d'environnement)
 * La carte native n'est plus utilisée (voir MissionMap.tsx) : la clé n'est nécessaire que pour la réactiver.
 */
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  // APK de test : autorise le HTTP simple (serveur d'un PC sur le même Wi-Fi). À ne PAS activer pour une version publiée.
  const cleartext = process.env.ALLOW_CLEARTEXT === "1";
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      // Kotlin 1.9.25 : le compilateur Compose de expo-modules-core l'exige (Expo SDK 52 fournit 1.9.24 : « requires Kotlin version 1.9.25 »).
      ["expo-build-properties", { android: { kotlinVersion: "1.9.25", ...(cleartext ? { usesCleartextTraffic: true } : {}) } }],
    ],
    ios: { ...config.ios, config: { ...(config.ios?.config ?? {}), googleMapsApiKey: key } },
    android: { ...config.android, config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: key } } },
  };
};
