import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "./api";
import { eurShort, needLabels, swapState, timeOf, whenLabel } from "./format";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, HoldButton, Slab } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (msg: string, tone?: "ok" | "bad") => void;
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Réseau indisponible");

/** Sur une mission acceptée : la proposer à un collègue (sans pénalité) tant que la limite n'est pas passée, ou la retirer. */
export function SwapControl({ r, notify, reload }: { r: any; notify: Notify; reload: () => void }) {
  const state = swapState(r);
  if (state === "closed") return null;
  async function go(withdraw: boolean) {
    try {
      await api(`/driver/rides/${r.rideId}/swap`, withdraw ? undefined : {}, withdraw ? "DELETE" : undefined);
      notify(withdraw ? "Mission retirée de la bourse d'échange" : "Mission proposée à vos collègues. Elle reste à vous tant que personne ne la reprend.", "ok");
    } catch (e) { notify(errMsg(e)); }
    reload();
  }
  return state === "offered" ? (
    <Card color={c.yel}>
      <Slab size={15} color={c.ink} shadow={null}>Mission à l'échange</Slab>
      <Cond size={12} color={c.ink}>Elle reste à vous tant qu'un collègue ne la reprend pas. Si personne ne la prend avant le {whenLabel(r.swapDeadline)}, elle vous reste.</Cond>
      <View style={{ marginTop: 8 }}><Btn label="Retirer de l'échange" color={c.cream} onPress={() => go(true)} /></View>
    </Card>
  ) : (
    <View style={{ gap: 4 }}>
      <Btn label="Proposer à un collègue (sans pénalité)" color={c.yel} onPress={() => go(false)} />
      <Cond size={11} color={c.muted} style={{ textAlign: "center" }}>Possible jusqu'au {whenLabel(r.swapDeadline)}. Ensuite : sauveteur ou restitution.</Cond>
    </View>
  );
}

/** Radar : missions que des collègues proposent à l'échange et que VOUS pouvez reprendre (véhicule, planning et repos vérifiés). */
export function SwapBoard({ notify }: { notify: Notify }) {
  const board = useFetch<any[]>("/driver/swaps", 15000);
  const [open, setOpen] = useState(false);
  const list = board.data ?? [];
  if (!list.length) return null;
  async function take(id: string) {
    try { const res = await api<{ ref: number }>(`/driver/swaps/${id}/take`, {}); notify(`Mission R-${res.ref} reprise : elle est dans votre Agenda`, "ok"); }
    catch (e) { notify(errMsg(e)); }
    board.reload();
  }
  return (
    <View style={{ marginTop: 6, marginBottom: 4 }}>
      <Btn label={`${open ? "▾" : "▸"} Bourse d'échange · ${list.length} mission${list.length > 1 ? "s" : ""}`} color={c.yel} onPress={() => setOpen(!open)} />
      {open && list.map((s) => (
        <Card key={s.id} color={c.cream}>
          <Cond size={12} color={c.muted}>{whenLabel(s.pickupAt)} · R-{s.ref}</Cond>
          <Slab size={14} color={c.ink} shadow={null}>{s.pickupAddress}</Slab>
          <Cond size={12} color={c.muted}>→ {s.dropoffAddress}</Cond>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
            <Chip label={`${eurShort(s.driverNetCents)} net`} color={c.blue} text={c.cream} />
            <Chip label={s.category} />
            <Chip label={`${Math.round(s.durationMin)} min · ${Math.round(s.distanceKm)} km`} />
            {needLabels(s.needs).map((l) => <Chip key={l} label={`⚠ ${l}`} color={c.red} text={c.cream} />)}
          </View>
          <Cond size={11} color={c.muted} style={{ marginBottom: 6 }}>Proposée par un collègue. Prix net de base, hors prime électrique éventuelle. Prise en charge à {timeOf(s.pickupAt)}.</Cond>
          <HoldButton label="Je la reprends" hint="Maintenir pour valider" onComplete={() => take(s.id)} />
        </Card>
      ))}
    </View>
  );
}
