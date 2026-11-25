import * as Location from "expo-location";
import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { api } from "./api";
import { c, font } from "./theme";
import { Btn, Card, Chip, Cond, Display, Slab, Sticker } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;
export const KINDS = [
  { key: "DANGER", label: "Danger : agression, menace", urgent: true },
  { key: "ACCIDENT", label: "Accident", urgent: true },
  { key: "BREAKDOWN", label: "Panne ou véhicule immobilisé", urgent: false },
  { key: "CLIENT", label: "Comportement d'un client", urgent: false },
  { key: "PAYMENT", label: "Problème de paiement", urgent: false },
  { key: "CONTROL", label: "Contrôle routier, verbalisation", urgent: false },
  { key: "OTHER", label: "Autre", urgent: false },
];
const EMERGENCY = [{ n: "112", t: "Urgences" }, { n: "17", t: "Police" }, { n: "15", t: "SAMU" }, { n: "18", t: "Pompiers" }];

/** Signaler un incident : l'équipe est alertée avec l'heure et la position. En cas de danger immédiat, les secours d'abord. */
export function IncidentScreen({ rideId, onClose, notify }: { rideId?: string; onClose: () => void; notify: Notify }) {
  const mine = useFetch<any[]>("/driver/incidents", 30000);
  const [kind, setKind] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<any>(null);
  const urgent = KINDS.find((k) => k.key === kind)?.urgent ?? false;

  async function send() {
    if (!kind) return;
    setBusy(true);
    try {
      let pos: { lat?: number; lng?: number } = {};
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === "granted") { const p = await Location.getCurrentPositionAsync({}); pos = { lat: p.coords.latitude, lng: p.coords.longitude }; }
      } catch { /* la dernière position connue est utilisée côté serveur */ }
      setSent(await api("/driver/incidents", { kind, ...(rideId ? { rideId } : {}), ...(message.trim() ? { message: message.trim() } : {}), ...pos }));
      mine.reload();
    } catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.sky }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Pressable onPress={onClose} accessibilityLabel="Fermer"><Sticker size={44} color={c.cream}><Slab size={20} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
          <Display size={34} shadow={c.red}>Signaler un incident</Display>

          <Card color={c.red}>
            <Slab size={16} color={c.cream} shadow={null}>Danger immédiat ? Appelez d'abord les secours.</Slab>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {EMERGENCY.map((e) => <Pressable key={e.n} onPress={() => Linking.openURL(`tel:${e.n}`)} accessibilityRole="button" accessibilityLabel={`Appeler le ${e.n}, ${e.t}`}><Chip label={`${e.n} · ${e.t}`} color={c.cream} text={c.red} /></Pressable>)}
            </View>
            <Cond size={11} color={c.cream}>Notre équipe n'est pas un service d'urgence.</Cond>
          </Card>

          {sent ? (
            <Card color={c.yel}>
              <Slab size={18} color={c.ink} shadow={null}>{sent.urgent ? "Alerte envoyée" : "Signalement envoyé"}</Slab>
              <Cond size={13} color={c.muted}>L'équipe est prévenue{sent.located ? " avec votre position" : ""}. Un message de confirmation est dans vos notifications.</Cond>
              <View style={{ marginTop: 10 }}><Btn label="Fermer" onPress={onClose} color={c.cream} /></View>
            </Card>
          ) : (
            <>
              <Cond size={12} color={c.onSky}>Que se passe-t-il ?</Cond>
              {KINDS.map((k) => (
                <Card key={k.key} color={kind === k.key ? c.yel : c.cream} onPress={() => setKind(k.key)} style={{ paddingVertical: 12 }}>
                  <Slab size={16} color={c.ink} shadow={null}>{k.label}</Slab>
                </Card>
              ))}
              {kind && (
                <Card>
                  <Cond size={11} color={c.muted}>Détail (facultatif)</Cond>
                  <TextInput style={{ fontFamily: font.slab, fontSize: 16, color: c.ink, paddingVertical: 8, borderBottomWidth: 2.5, borderColor: c.ink }} value={message} onChangeText={setMessage} placeholder="Quelques mots pour l'équipe" placeholderTextColor="#9a9ab0" multiline maxLength={500} />
                </Card>
              )}
              {kind && <Btn label={busy ? "Envoi…" : urgent ? "Envoyer l'alerte à l'équipe" : "Envoyer le signalement"} color={urgent ? c.red : c.blue} text={c.cream} onPress={send} disabled={busy} />}
            </>
          )}

          {(mine.data ?? []).length > 0 && (
            <>
              <Cond size={12} color={c.onSky}>Mes signalements</Cond>
              {mine.data!.slice(0, 5).map((i) => (
                <Card key={i.id} style={{ paddingVertical: 10 }}>
                  <Slab size={14} color={c.ink} shadow={null}>{i.label}</Slab>
                  <Cond size={11} color={c.muted}>{new Date(i.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {i.status === "OPEN" ? "en attente" : i.status === "ACKNOWLEDGED" ? "pris en charge" : `clos${i.resolution ? ` : ${i.resolution}` : ""}`}</Cond>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Carte de l'onglet Cap. */
export function IncidentCard({ onOpen }: { onOpen: () => void }) {
  return (
    <Card onPress={onOpen}>
      <Slab size={17} color={c.ink} shadow={null}>Signaler un incident</Slab>
      <Cond size={12} color={c.muted}>Danger, accident, panne, client, paiement, contrôle →</Cond>
    </Card>
  );
}
