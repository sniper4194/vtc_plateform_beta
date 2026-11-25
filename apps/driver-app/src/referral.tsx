import { useState } from "react";
import { Share, View } from "react-native";
import { api, ApiError } from "./api";
import { eurShort } from "./format";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, Slab } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;

/** Accueil : codes de parrainage du chauffeur (un code = un filleul), et la règle de la prime si elle est active. */
export function ReferralCard({ notify }: { notify: Notify }) {
  const q = useFetch<any>("/driver/referral", 60000);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d || (!d.codes.length && !d.canCreate)) return null;
  async function create() {
    setBusy(true);
    try { const r = await api<{ code: string }>("/driver/referral", {}); notify(`Code ${r.code} créé`, "ok"); }
    catch (e) { notify(e instanceof ApiError ? e.message : "Réseau indisponible"); }
    finally { setBusy(false); q.reload(); }
  }
  const share = (code: string) => Share.share({ message: `Je vous recommande pour rouler avec CliCab. Votre code de parrainage : ${code}` }).catch(() => {});
  return (
    <Card>
      <Slab size={17} color={c.ink} shadow={null}>Parrainage</Slab>
      <Cond size={12} color={c.muted}>Vous recommandez un chauffeur que vous connaissez : vous restez son référent. Un code sert une seule fois.</Cond>
      {d.reward && (
        <Cond size={12} color={c.ink} style={{ marginTop: 6 }}>
          Prime : {eurShort(d.reward.amountCents)} pour chacune des {d.reward.rides} premières courses terminées de votre filleul, payée par CliCab sur sa commission (rien n'est retenu au filleul). Reçu à ce jour : {eurShort(d.reward.earnedCents)}.
        </Cond>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {d.codes.map((x: any) => (
          <Chip key={x.code} label={`${x.code}${x.used ? " · utilisé" : x.revoked ? " · annulé" : ""}`} color={x.used || x.revoked ? c.cream : c.yel} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        {d.canCreate && <View style={{ flex: 1 }}><Btn label={`Nouveau code (${d.remaining})`} color={c.yel} disabled={busy} onPress={create} /></View>}
        {d.codes.some((x: any) => !x.used && !x.revoked) && (
          <View style={{ flex: 1 }}><Btn label="Partager" onPress={() => share(d.codes.find((x: any) => !x.used && !x.revoked).code)} /></View>
        )}
      </View>
    </Card>
  );
}
