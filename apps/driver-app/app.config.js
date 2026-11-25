/**
 * Configuration Expo. La clé Google Maps n'est jamais écrite dans le dépôt :
 *   GOOGLE_MAPS_API_KEY=... npx expo run:android   (ou build EAS avec la variable d'environnement)
 * Sans clé, la carte native s'affiche vide/grise ; le reste de l'app fonctionne.
 */
module.exports = ({ config }) => {
  const test = process.env.EXPO_PUBLIC_CLICAB_TEST === '1';
  const key = test ? undefined : process.env.GOOGLE_MAPS_API_KEY;
  // APK de test : autorise le HTTP simple (serveur d'un PC sur le même Wi-Fi). À ne PAS activer pour une version publiée.
  const cleartext = !test && process.env.ALLOW_CLEARTEXT === "1";
  return {
    ...config,
    ...(test ? { name: 'CliCab TEST', slug: 'clicab-driver-test' } : {}),
    plugins: [
      ...(config.plugins ?? []),
      // Kotlin 1.9.25 : le compilateur Compose de expo-modules-core l'exige (Expo SDK 52 fournit 1.9.24 : « requires Kotlin version 1.9.25 »).
      ["expo-build-properties", { android: { kotlinVersion: "1.9.25", ...(cleartext ? { usesCleartextTraffic: true } : {}) } }],
    ],
    ios: { ...config.ios, ...(test ? {bundleIdentifier:'com.clicab.driver.test'} : {}), config: { ...(config.ios?.config ?? {}), googleMapsApiKey: key } },
    android: { ...config.android, ...(test ? {package:'com.clicab.driver.test'} : {}), config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: key } } },
  };
};
