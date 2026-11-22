import { Modal, Pressable, ScrollView, View } from "react-native";
import { c } from "./theme";
import { Card, Chip, Cond, Display, Slab, Sticker } from "./ui";
import { Deadline, deadlineSummary, deadlineText } from "./deadlinesFormat";
import { useFetch } from "./useFetch";

export type { Deadline } from "./deadlinesFormat";

/** Carte de l'onglet Cap : résumé des échéances ; jaune ou rouge s'il y a quelque chose à faire. */
export function DeadlinesCard({ onOpen, list }: { onOpen: () => void; list: Deadline[] | null }) {
  const bad = !!list?.some((d) => d.status === "EXPIRED" || d.status === "MISSING");
  const soon = !!list?.some((d) => d.status === "SOON");
  return (
    <Card color={bad ? c.red : soon ? c.yel : c.cream} onPress={onOpen}>
      <Slab size={17} color={bad ? c.cream : c.ink} shadow={null}>Mes échéances</Slab>
      <Cond size={12} color={bad ? c.cream : c.muted}>{deadlineSummary(list)} →</Cond>
    </Card>
  );
}

export function DeadlinesScreen({ onClose }: { onClose: () => void }) {
  const q = useFetch<Deadline[]>("/driver/deadlines", 30000);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.sky }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          <Pressable onPress={onClose} accessibilityLabel="Fermer"><Sticker size={44} color={c.cream}><Slab size={20} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
          <Display size={32} shadow={c.red}>Mes échéances</Display>
          <Cond size={12} color={c.onSky}>Vous êtes prévenu 30, 14, 7 et 1 jours avant, puis hors ligne à l'expiration.</Cond>
          {(q.data ?? []).map((d) => {
            const bad = d.status === "EXPIRED" || d.status === "MISSING";
            return (
              <Card key={d.type} color={bad ? c.red : d.status === "SOON" ? c.yel : c.cream} style={{ paddingVertical: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Slab size={16} color={bad ? c.cream : c.ink} shadow={null}>{d.label}</Slab>
                    <Cond size={12} color={bad ? c.cream : c.muted}>{deadlineText(d)}</Cond>
                  </View>
                  <Chip label={d.status === "OK" ? "OK" : d.status === "SOON" ? "Bientôt" : d.status === "EXPIRED" ? "Expiré" : d.status === "MISSING" ? "Manquant" : "En cours"} color={bad ? c.cream : c.cream} text={bad ? c.red : c.ink} />
                </View>
              </Card>
            );
          })}
          <Cond size={12} color={c.onSky}>Pour transmettre un nouveau document, contactez l'équipe (l'envoi depuis l'application n'est pas encore disponible).</Cond>
        </ScrollView>
      </View>
    </Modal>
  );
}
