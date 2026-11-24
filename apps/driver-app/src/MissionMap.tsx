import { useState } from "react";
import { LayoutChangeEvent, View } from "react-native";
import { c } from "./theme";
import { Cond } from "./ui";

export interface MapPoint { lat: number; lng: number }
export interface MissionMapProps { pickup: MapPoint; dropoff: MapPoint; driver?: MapPoint | null; target: "pickup" | "dropoff" }

/**
 * Repli sans carte (web / démo) : schéma des points et du trajet restant.
 * Sur mobile, MissionMap.native.tsx affiche la vraie carte Google Maps.
 */
export function MissionMap({ pickup, dropoff, driver, target }: MissionMapProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pts = [pickup, dropoff, ...(driver ? [driver] : [])];
  const lat = pts.map((p) => p.lat), lng = pts.map((p) => p.lng);
  const minLat = Math.min(...lat), maxLat = Math.max(...lat), minLng = Math.min(...lng), maxLng = Math.max(...lng);
  const pad = 0.27;
  const place = (p: MapPoint) => ({
    x: size.w * (pad + (1 - 2 * pad) * (maxLng === minLng ? 0.5 : (p.lng - minLng) / (maxLng - minLng))),
    y: size.h * (pad + (1 - 2 * pad) * (maxLat === minLat ? 0.5 : 1 - (p.lat - minLat) / (maxLat - minLat))),
  });
  const from = place(driver ?? pickup), to = place(target === "pickup" ? pickup : dropoff);
  const len = Math.hypot(to.x - from.x, to.y - from.y), ang = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const Pin = ({ p, color, label }: { p: { x: number; y: number }; color: string; label: string }) => (
    <View style={{ position: "absolute", left: p.x - 14, top: p.y - 14, alignItems: "center" }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, borderWidth: 3, borderColor: c.ink }} />
      <View style={{ marginTop: 4, backgroundColor: c.cream, borderWidth: 2, borderColor: c.ink, borderRadius: 8, paddingHorizontal: 6 }}><Cond size={11}>{label}</Cond></View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: "#e3f4fd" }} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: `${i * 12.5}%`, height: 2, backgroundColor: "#b9dff3" }} />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${i * 20}%`, width: 2, backgroundColor: "#b9dff3" }} />
      ))}
      {size.w > 0 && (
        <>
          <View style={{ position: "absolute", left: from.x, top: from.y - 2, width: len, height: 0, borderTopWidth: 4, borderStyle: "dashed", borderColor: c.blue, transform: [{ translateX: 0 }, { rotate: `${ang}deg` }], transformOrigin: "0 0" } as any} />
          <Pin p={place(pickup)} color={c.red} label="Prise en charge" />
          <Pin p={place(dropoff)} color={c.blue} label="Destination" />
          {driver && <Pin p={place(driver)} color={c.yel} label="Vous" />}
        </>
      )}
    </View>
  );
}
