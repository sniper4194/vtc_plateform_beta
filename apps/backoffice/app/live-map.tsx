"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { api, dt } from "../lib/api";

type Live = { id: string; name: string; availability: string; lat: number; lng: number; ageSec: number;
  ride: { id: string; ref: number; status: string; pickupAddress: string; dropoffAddress: string; pickupAt: string } | null };

const STEP: Record<string, string> = { ASSIGNED: "Attribuée", EN_ROUTE: "En route", ARRIVED: "Sur place", IN_PROGRESS: "À bord" };
// Fond de carte OpenStreetMap (gratuit, attribution obligatoire ; usage modéré). Remplaçable par NEXT_PUBLIC_MAP_TILES.
const TILES = process.env.NEXT_PUBLIC_MAP_TILES ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const color = (d: Live) => (d.ageSec > 180 ? "#8a8f9c" : d.ride && d.ride.status !== "ASSIGNED" ? "#1552a0" : d.availability === "AVAILABLE" ? "#15734a" : "#f9ae00");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Carte en direct des chauffeurs (dernière position connue, mise à jour toutes les 10 s). */
export function LiveMap() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const [list, setList] = useState<Live[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false, timer: any;
    (async () => {
      const L = (await import("leaflet")).default;
      if (stop || !box.current) return;
      map.current = L.map(box.current).setView([48.8566, 2.3522], 10);
      L.tileLayer(TILES, { maxZoom: 19, attribution: "© les contributeurs d'OpenStreetMap" }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      const load = async () => {
        try {
          const data = await api<Live[]>("/admin/live");
          if (stop) return;
          setList(data); setErr("");
          layer.current.clearLayers();
          for (const d of data) {
            const info = d.ride ? `<br>${esc(STEP[d.ride.status] ?? d.ride.status)} · R-${d.ride.ref}<br>${esc(d.ride.pickupAddress)} → ${esc(d.ride.dropoffAddress)}` : `<br>${d.availability === "AVAILABLE" ? "Disponible" : "Hors ligne"}`;
            L.circleMarker([d.lat, d.lng], { radius: 9, color: "#14172b", weight: 2, fillColor: color(d), fillOpacity: 0.95 })
              .bindPopup(`<b>${esc(d.name)}</b>${info}<br><small>vu il y a ${d.ageSec} s</small>`).addTo(layer.current);
          }
        } catch (e: any) { setErr(e.message); }
      };
      await load();
      timer = setInterval(load, 10_000);
    })();
    return () => { stop = true; clearInterval(timer); map.current?.remove(); map.current = null; };
  }, []);

  const focus = (d: Live) => { map.current?.setView([d.lat, d.lng], 15); };
  return (
    <>
      <h1 className="title">Carte en direct</h1>
      {err && <div className="card redbg">{err}</div>}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={box} aria-label="Carte des chauffeurs" style={{ height: "62vh", minHeight: 360 }} />
      </div>
      <div className="card">
        <div className="chips" style={{ marginBottom: 8 }}>
          <span className="chip" style={{ background: "#1552a0", color: "#fff" }}>En mission</span>
          <span className="chip" style={{ background: "#f9ae00" }}>Mission attribuée</span>
          <span className="chip" style={{ background: "#15734a", color: "#fff" }}>Disponible</span>
          <span className="chip" style={{ background: "#8a8f9c", color: "#fff" }}>Position de plus de 3 min</span>
        </div>
        {!list.length && <p className="muted">Aucun chauffeur vu ces 10 dernières minutes.</p>}
        {!!list.length && (
          <table>
            <thead><tr><th>Chauffeur</th><th>Mission</th><th>Vu il y a</th><th></th></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.ride ? `${STEP[d.ride.status] ?? d.ride.status} · R-${d.ride.ref} · ${dt(d.ride.pickupAt)}` : d.availability === "AVAILABLE" ? "Disponible" : "—"}</td>
                <td>{d.ageSec < 60 ? `${d.ageSec} s` : `${Math.round(d.ageSec / 60)} min`}</td>
                <td><button className="btn" onClick={() => focus(d)}>Voir</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
