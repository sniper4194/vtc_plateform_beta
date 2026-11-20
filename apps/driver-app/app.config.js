/**
 * Configuration Expo. La clé Google Maps n'est jamais écrite dans le dépôt :
 *   GOOGLE_MAPS_API_KEY=... npx expo run:android   (ou build EAS avec la variable d'environnement)
 * Sans clé, la carte native s'affiche vide/grise ; le reste de l'app fonctionne.
 */
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return {
    ...config,
    ios: { ...config.ios, config: { ...(config.ios?.config ?? {}), googleMapsApiKey: key } },
    android: { ...config.android, config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: key } } },
  };
};
