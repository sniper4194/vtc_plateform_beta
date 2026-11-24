import { useState } from "react";
import { TextInput, View } from "react-native";
import { api, ApiError } from "./api";
import { whenLabel } from "./format";
import { c } from "./theme";
import { Btn, Card, Cond, Slab } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;

/** Accueil : objets oubliés signalés par vos voyageurs, en attente de votre réponse. Rien ne s'affiche s'il n'y en a pas. */
export function LostItemsCard({ notify }: { notify: Notify }) {
  const list = useFetch<any[]>("/driver/lost-items", 30000);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const open = (list.data ?? []).filter((l) => l.status === "OPEN");
  if (!open.length) return null;
  async function answer(id: string, found: boolean) {
    setBusy(true);
    try {
      await api(`/driver/lost-items/${id}/answer`, { found, note: note[id] || undefined });
      notify(found ? "Merci ! L'équipe CliCab organise la restitution avec le voyageur." : "Réponse envoyée au voyageur", "ok");
    } catch (e) { notify(e instanceof ApiError ? e.message : "Réseau indisponible"); }
    finally { setBusy(false); list.reload(); }
  }
  return (
    <View style={{ gap: 14 }}>
      {open.map((l) => (
        <Card key={l.id} color={c.yel}>
          <Cond size={12} color={c.ink}>Objet oublié · R-{l.ref} · {whenLabel(l.pickupAt)}</Cond>
          <Slab size={16} color={c.ink} shadow={null}>« {l.description} »</Slab>
          <Cond size={12} color={c.muted}>Vérifiez votre véhicule. Gardez l'objet : l'équipe vous contacte pour la restitution.</Cond>
          <TextInput
            placeholder="Précision (facultatif) : où l'objet se trouvait…" placeholderTextColor={c.muted} maxLength={300}
            value={note[l.id] ?? ""} onChangeText={(v) => setNote({ ...note, [l.id]: v })}
            style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 10, padding: 10, backgroundColor: c.cream, color: c.ink, marginTop: 8 }}
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Btn label="Je l'ai trouvé" color={c.blue} text={c.cream} disabled={busy} onPress={() => answer(l.id, true)} /></View>
            <View style={{ flex: 1 }}><Btn label="Pas trouvé" disabled={busy} onPress={() => answer(l.id, false)} /></View>
          </View>
        </Card>
      ))}
    </View>
  );
}
