import { useEffect, useRef } from "react";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import Constants from "expo-constants";
import { c } from "./theme";
import { MissionSchema, type MissionMapProps } from "./MissionSchema";

export type { MapPoint, MissionMapProps } from "./MissionSchema";

/** Vrai si l'APK a été construit avec une clé Google Maps (GOOGLE_MAPS_API_KEY). */
export const hasGoogleMapsKey = () => Boolean((Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey);

/** Carte Google Maps (SDK mobile). Le tracé est une ligne droite vers l'étape en cours : pas d'itinéraire routier ici. */
export function MissionMap(props: MissionMapProps) {
  // Sans clé, la carte Google fait planter l'application (« API key not found », journal Android du parcours no-show) : schéma à la place.
  return hasGoogleMapsKey() ? <GoogleMissionMap {...props} /> : <MissionSchema {...props} />;
}

function GoogleMissionMap({ pickup, dropoff, driver, target }: MissionMapProps) {
  const ref = useRef<MapView>(null);
  const to = target === "pickup" ? pickup : dropoff;
  const key = [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, driver?.lat, driver?.lng].join(",");
  useEffect(() => {
    const coords = [pickup, dropoff, ...(driver ? [driver] : [])].map((p) => ({ latitude: p.lat, longitude: p.lng }));
    ref.current?.fitToCoordinates(coords, { edgePadding: { top: 90, right: 60, bottom: 40, left: 60 }, animated: true });
  }, [key]);
  return (
    <MapView
      ref={ref}
      style={{ flex: 1 }}
      provider={PROVIDER_GOOGLE}
      initialRegion={{ latitude: to.lat, longitude: to.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
      showsUserLocation
      toolbarEnabled={false}
    >
      <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Prise en charge" pinColor={c.red} />
      <Marker coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }} title="Destination" pinColor={c.blue} />
      <Polyline
        coordinates={[{ latitude: (driver ?? pickup).lat, longitude: (driver ?? pickup).lng }, { latitude: to.lat, longitude: to.lng }]}
        strokeColor={c.blue}
        strokeWidth={4}
        lineDashPattern={[10, 8]}
      />
    </MapView>
  );
}
