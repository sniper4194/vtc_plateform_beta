"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

type P = { lat: number; lng: number };
// Fond de carte OpenStreetMap (attribution obligatoire). Remplaçable par NEXT_PUBLIC_MAP_TILES.
const TILES = process.env.NEXT_PUBLIC_MAP_TILES ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Position du chauffeur en direct et lieu visé (prise en charge, puis destination). Mise à jour à chaque rafraîchissement de la page. */
export function DriverMap({ driver, target, label, targetLabel }: { driver: P; target: P | null; label: string; targetLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const marks = useRef<{ car?: any; spot?: any; fitted?: boolean }>({});
  useEffect(() => {
    let gone = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (gone || !box.current) return;
      if (!map.current) {
        map.current = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([driver.lat, driver.lng], 14);
        L.tileLayer(TILES, { maxZoom: 19, attribution: "© les contributeurs d'OpenStreetMap" }).addTo(map.current);
      }
      const m = marks.current;
      if (!m.car) m.car = L.circleMarker([driver.lat, driver.lng], { radius: 10, color: "#14172b", weight: 3, fillColor: "#1a66c2", fillOpacity: 1 }).bindTooltip(label).addTo(map.current);
      else m.car.setLatLng([driver.lat, driver.lng]);
      if (target) {
        if (!m.spot) m.spot = L.circleMarker([target.lat, target.lng], { radius: 8, color: "#14172b", weight: 3, fillColor: "#f7b30a", fillOpacity: 1 }).bindTooltip(targetLabel).addTo(map.current);
        else m.spot.setLatLng([target.lat, target.lng]);
        if (!m.fitted) { map.current.fitBounds(L.latLngBounds([[driver.lat, driver.lng], [target.lat, target.lng]]).pad(0.3)); m.fitted = true; }
      }
    })();
    return () => { gone = true; };
  }, [driver.lat, driver.lng, target?.lat, target?.lng, label, targetLabel]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);
  return <div ref={box} role="img" aria-label={label} style={{ height: 240, borderRadius: 12, overflow: "hidden", marginTop: 12 }} />;
}
