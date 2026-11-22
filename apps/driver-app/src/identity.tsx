import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { api } from "./api";
import { timeOf } from "./format";
import { c, font } from "./theme";
import { Btn, Card, Chip, Cond, Display, Slab, Sticker } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;
const input = { fontFamily: font.slab, fontSize: 17, color: c.ink, paddingVertical: 8, borderBottomWidth: 2.5, borderColor: c.ink } as const;

function Field({ label, value, onChange, placeholder, keyboard }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; keyboard?: "default" | "number-pad" }) {
  return (
    <View style={{ gap: 2 }}>
      <Cond size={11} color={c.muted}>{label}</Cond>
      <TextInput style={input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#9a9ab0" keyboardType={keyboard ?? "default"} autoCapitalize="characters" />
    </View>
  );
}

/** Mon identité : informations d'exploitant (justificatif de réservation, validation) et selfie de prise de service. */
export function IdentityScreen({ onClose, notify, onChanged }: { onClose: () => void; notify: Notify; onChanged?: () => void }) {
  const st = useFetch<any>("/driver/identity", 15000);
  const d = st.data;
  const [f, setF] = useState({ businessName: "", siret: "", revtcNumber: "", proCardNumber: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (d) setF({ businessName: d.businessName ?? "", siret: d.siret ?? "", revtcNumber: d.revtcNumber ?? "", proCardNumber: d.proCardNumber ?? "" }); }, [d?.businessName, d?.siret, d?.revtcNumber, d?.proCardNumber]);

  async function save() {
    setBusy(true);
    try {
      const body: any = {};
      for (const [k, v] of Object.entries(f)) if (v.trim() && (!d.attachedToCompany || k === "proCardNumber")) body[k] = v.trim();
      await api("/driver/identity", body);
      notify("Informations enregistrées", "ok");
      await st.reload(); onChanged?.();
    } catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }

  async function selfie() {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { notify("L'accès à la caméra est nécessaire pour le selfie"); return; }
      const r = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: 0.3, base64: true, allowsEditing: false, mediaTypes: ["images"] });
      if (r.canceled || !r.assets?.[0]?.base64) return;
      const res = await api("/driver/identity/selfie", { image: r.assets[0].base64, mime: "image/jpeg" });
      notify(res.kind === "REFERENCE" ? "Photo envoyée : l'équipe la valide" : "Selfie validé : bonne route !", "ok");
      await st.reload(); onChanged?.();
    } catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }

  const s = d?.selfie;
  const selfieLine = !s ? "…"
    : s.referenceStatus === "NONE" ? "Aucune photo : prenez un selfie, de face, visage découvert."
    : s.referenceStatus === "PENDING" ? "Photo reçue : en cours de validation par l'équipe."
    : s.mustVerify ? `Selfie à reprendre (valable ${s.validHours} h).`
    : `Selfie valable jusqu'à ${timeOf(s.validUntil)}.`;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.sky }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Pressable onPress={onClose} accessibilityLabel="Fermer"><Sticker size={44} color={c.cream}><Slab size={20} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
          <Display size={34} shadow={c.red}>Mon identité</Display>

          <Card color={s?.mustVerify ? c.yel : c.cream}>
            <Slab size={17} color={c.ink} shadow={null}>Selfie de prise de service</Slab>
            <Cond size={12} color={c.muted}>{selfieLine}</Cond>
            <Cond size={12} color={c.muted}>Il protège votre compte : personne d'autre ne peut rouler à votre place.</Cond>
            <View style={{ marginTop: 10 }}><Btn label={s?.referenceStatus === "VALID" ? "Prendre un selfie" : "Prendre ma photo"} color={c.blue} text={c.cream} onPress={selfie} disabled={busy} /></View>
          </Card>

          <Card>
            <Slab size={17} color={c.ink} shadow={null}>Informations d'exploitant</Slab>
            {d?.attachedToCompany
              ? <Cond size={12} color={c.muted}>Vous êtes rattaché à {d.companyName} : seule votre carte professionnelle est à renseigner ici.</Cond>
              : <Cond size={12} color={c.muted}>Elles figurent sur votre justificatif de réservation, à présenter en cas de contrôle.</Cond>}
            {d && d.missing.length > 0 && <Chip label={`À compléter : ${d.missing.join(", ")}`} color={c.red} text={c.cream} />}
            <View style={{ gap: 8, marginTop: 8 }}>
              {!d?.attachedToCompany && <Field label="Raison sociale (ou nom)" value={f.businessName} onChange={(v) => setF({ ...f, businessName: v })} />}
              {!d?.attachedToCompany && <Field label="Siren ou Siret (9 ou 14 chiffres)" value={f.siret} onChange={(v) => setF({ ...f, siret: v.replace(/\D/g, "") })} keyboard="number-pad" />}
              {!d?.attachedToCompany && <Field label="N° d'inscription au registre des VTC (REVTC)" value={f.revtcNumber} onChange={(v) => setF({ ...f, revtcNumber: v })} />}
              <Field label="N° de carte professionnelle VTC" value={f.proCardNumber} onChange={(v) => setF({ ...f, proCardNumber: v })} />
            </View>
            <View style={{ marginTop: 10 }}><Btn label="Enregistrer" color={c.yel} onPress={save} disabled={busy} /></View>
          </Card>
        </ScrollView>
      </View>
    </Modal>
  );
}
