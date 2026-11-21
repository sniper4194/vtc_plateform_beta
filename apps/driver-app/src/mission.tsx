import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { api } from "./api";
import { countdown, eurShort, isCancelled, MISSION_TITLE, NEXT_ACTION, secondsUntil, timeOf, waitedMin } from "./format";
import { MissionMap, MapPoint } from "./MissionMap";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, Display, HoldButton, Slab, Sticker } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;

const navLinks = (p: MapPoint) => [
  { label: "Google Maps", url: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving` },
  { label: "Waze", url: `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes` },
  ...(Platform.OS === "ios" ? [{ label: "Plans", url: `http://maps.apple.com/?daddr=${p.lat},${p.lng}` }] : []),
];

/** Pancarte plein écran : lisible de loin, à montrer au client dans le hall d'arrivée. */
function SignModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: c.cream, alignItems: "center", justifyContent: "center", padding: 28 }}>
        <View style={{ transform: [{ rotate: "90deg" }], width: 640, alignItems: "center" }}>
          <Display size={72} color={c.blue} shadow={c.red} style={{ textAlign: "center", lineHeight: 80 }}>{text}</Display>
        </View>
        <View style={{ position: "absolute", bottom: 40 }}><Cond size={13} color={c.muted}>Toucher pour fermer</Cond></View>
      </Pressable>
    </Modal>
  );
}

export function MissionScreen({ rideId, onClose, notify }: { rideId: string; onClose: () => void; notify: Notify }) {
  const ride = useFetch<any>(`/driver/rides/${rideId}`, 4000);
  const [pos, setPos] = useState<MapPoint | null>(null);
  const [, setTick] = useState(0);
  const [sign, setSign] = useState(false);
  const [nav, setNav] = useState(false);
  const [problem, setProblem] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let stop = false;
    async function locate() {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || stop) return;
        const p = await Location.getCurrentPositionAsync({});
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      } catch { /* la carte fonctionne sans la position du chauffeur */ }
    }
    locate();
    const t = setInterval(locate, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const r = ride.data;
  if (!r) return <View style={{ flex: 1, backgroundColor: c.sky, justifyContent: "center", alignItems: "center" }}><Cond size={14} color={c.onSky}>{ride.error || "Chargement…"}</Cond></View>;

  const target: "pickup" | "dropoff" = r.status === "IN_PROGRESS" ? "dropoff" : "pickup";
  const place = r[target];
  const next = NEXT_ACTION(r.status);
  const done = r.status === "COMPLETED";
  const cancelled = isCancelled(r.status);
  const delayed = (r.flight?.delayMin ?? 0) > 0;
  const waited = waitedMin(r.arrivedAt);
  const noShowIn = r.status === "ARRIVED" ? secondsUntil(r.noShowAllowedAt) : 0;

  async function run(action: string) {
    try { await api(`/driver/rides/${rideId}/${action}`, {}); await ride.reload(); }
    catch (e: any) { notify(e.message); }
  }
  async function giveBack() {
    if (!confirm) { setConfirm(true); notify("Cela pèse sur votre score de fiabilité. Touchez à nouveau pour confirmer."); return; }
    await run("cancel"); onClose();
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.sky }}>
      <View style={{ flex: 1 }}>
        <MissionMap pickup={r.pickup} dropoff={r.dropoff} driver={pos} target={target} />
        <View style={{ position: "absolute", top: 14, left: 16 }}>
          <Pressable onPress={onClose} accessibilityLabel="Retour"><Sticker size={48} color={c.cream}><Slab size={22} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
        </View>
        <View style={{ position: "absolute", top: 14, right: 16 }}><Chip label={r.partner ?? "Mission"} color={c.yel} /></View>
      </View>

      <View style={{ maxHeight: "68%", backgroundColor: c.cream, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 3, borderColor: c.ink }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          <Display size={32} color={c.ink} shadow={c.yel}>{MISSION_TITLE[r.status] ?? r.status}</Display>
          <Cond size={12} color={c.muted}>{r.reference}</Cond>
          <Slab size={14} color={c.muted} shadow={null}>{place.address}</Slab>

          {r.flight && !cancelled && (
            <View style={{ backgroundColor: delayed ? c.yel : c.cream, borderWidth: 2.5, borderColor: c.ink, borderRadius: 12, padding: 10 }}>
              <Cond size={12} color={c.ink}>Vol {r.flight.number} · {r.flight.status === "DELAYED" ? "retardé" : r.flight.status === "LANDED" ? "posé" : r.flight.status === "CANCELLED" ? "annulé" : "à l'heure"}</Cond>
              <Slab size={16} color={c.ink} shadow={null}>
                {delayed
                  ? `Atterrissage ${timeOf(r.flight.scheduledArrivalAt)}  →  ${timeOf(new Date(new Date(r.flight.scheduledArrivalAt).getTime() + r.flight.delayMin * 60_000).toISOString())}  (+${r.flight.delayMin} min)`
                  : `Atterrissage prévu ${timeOf(r.flight.scheduledArrivalAt)}`}
              </Slab>
              <Cond size={12} color={c.ink}>Prise en charge {timeOf(r.effectivePickupAt)}{r.flight.bufferMin > 0 ? ` · ${r.flight.bufferMin} min après l'atterrissage` : ""}</Cond>
            </View>
          )}

          {r.status === "ARRIVED" && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Sticker size={74} color={c.red} rot={-6}><Display size={30} color={c.cream} shadow={c.dblue}>{waited}</Display><Cond size={10} color={c.cream}>min</Cond></Sticker>
              <View style={{ flex: 1 }}>
                <Slab size={16} color={c.ink} shadow={null}>Attente depuis {waited} min</Slab>
                <Cond size={12} color={c.muted}>{noShowIn > 0 ? `Client absent déclarable dans ${countdown(noShowIn)}` : "Vous pouvez déclarer le client absent (Un souci ?)"}</Cond>
              </View>
            </View>
          )}

          {(r.status === "EN_ROUTE" || r.status === "ARRIVED" || r.status === "ASSIGNED") && (
            <Btn label="Afficher la pancarte" color={c.blue} text={c.cream} onPress={() => setSign(true)} />
          )}

          <View style={{ gap: 6 }}>
            <Cond size={11} color={c.muted}>Passager</Cond>
            <Slab size={17} color={c.ink} shadow={null}>{r.passenger.name}</Slab>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Chip label={r.rideType === "FORFAIT" ? "Course au forfait" : "Au compteur"} color={c.yel} />
              <Chip label={r.category} />
              <Chip label={`${r.passengers} pers. · ${r.luggage} bag.`} />
              <Chip label={`${eurShort(r.netCents)} net`} color={c.blue} text={c.cream} />
            </View>
            {r.notes ? <Cond size={13} color={c.red}>Consigne : {r.notes}</Cond> : null}
          </View>

          {!cancelled && <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Btn label="Appeler" color={c.yel} onPress={() => Linking.openURL(`tel:${r.passenger.phone}`)} /></View>
            <View style={{ flex: 1 }}><Btn label="Guidage" onPress={() => setNav(!nav)} /></View>
          </View>}
          {nav && (
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {navLinks(place).map((n) => <Btn key={n.label} label={n.label} onPress={() => Linking.openURL(n.url)} />)}
            </View>
          )}

          {cancelled ? (
            <Card color={c.red}>
              <Slab size={16} color={c.cream} shadow={null}>Vous n'êtes plus tenu de réaliser cette mission.</Slab>
              <Cond size={13} color={c.cream}>{r.compensationCents > 0 ? `Indemnité d'annulation : ${eurShort(r.compensationCents)}, versée avec votre prochain relevé.` : "Aucune indemnité d'annulation n'est due."}</Cond>
              <View style={{ marginTop: 10 }}><Btn label="Retour" onPress={onClose} color={c.cream} /></View>
            </Card>
          ) : done ? (
            <Card color={c.yel}>
              <Cond size={13}>Mission terminée</Cond>
              <Display size={44} color={c.ink} shadow={c.red}>{eurShort(r.netCents)}</Display>
              <Cond size={12} color={c.muted}>net pour vous</Cond>
              <View style={{ marginTop: 10 }}><Btn label="Retour à l'agenda" onPress={onClose} color={c.cream} /></View>
            </Card>
          ) : (
            <>
              {next && <HoldButton label={next.hold} onComplete={() => run(next.action)} />}
              <Pressable onPress={() => { setProblem(!problem); setConfirm(false); }}><Cond size={13} color={c.blue} style={{ textAlign: "center", textDecorationLine: "underline" }}>Un souci ?</Cond></Pressable>
              {problem && r.status === "ARRIVED" && <Btn label={noShowIn > 0 ? `Client absent (dans ${countdown(noShowIn)})` : "Client introuvable (no-show)"} color={c.red} text={c.cream} disabled={noShowIn > 0} onPress={() => run("no-show")} />}
              {problem && (r.status === "ASSIGNED" || r.status === "EN_ROUTE") && <Btn label={confirm ? "Confirmer : je rends la mission" : "Je ne peux plus la faire"} color={c.red} text={c.cream} onPress={giveBack} />}
            </>
          )}
        </ScrollView>
      </View>
      {sign && <SignModal text={r.signText} onClose={() => setSign(false)} />}
    </View>
  );
}
