import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { api } from "./api";
import { eurShort, timeOf } from "./format";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, Display, Slab, Sticker } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;

const REASONS = ["Panne de véhicule", "Malaise ou urgence personnelle", "Accident ou immobilisation", "Retard impossible à rattraper"];

/** Carte de l'onglet Cap : statut sauveteur, critères, adhésion et appels à l'aide reçus. */
export function RescueCard({ notify, onAccepted }: { notify: Notify; onAccepted: (rideId: string) => void }) {
  const st = useFetch<any>("/driver/rescue/status", 10000);
  const inc = useFetch<any[]>("/driver/rescue/incoming", 5000);
  const [busy, setBusy] = useState(false);
  const s = st.data;
  if (!s) return null;

  async function act(fn: () => Promise<any>, okText?: string) {
    setBusy(true);
    try { const r = await fn(); if (okText) notify(okText, "ok"); await Promise.all([st.reload(), inc.reload()]); return r; }
    catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 14 }}>
      {(inc.data ?? []).map((r) => (
        <Card key={r.id} color={c.red}>
          <Cond size={12} color={c.yel}>Appel à l'aide{r.direct ? " · vous avez été choisi" : ""} · {Math.max(1, Math.ceil(r.secondsLeft / 60))} min</Cond>
          <Slab size={17} color={c.cream} shadow={null}>{r.requester} : « {r.reason} »</Slab>
          <Cond size={13} color={c.cream}>{timeOf(r.pickupAt)} · {r.pickup}{r.awayKm != null ? ` · à ${r.awayKm} km de vous` : ""}</Cond>
          <Cond size={13} color={c.cream}>→ {r.dropoff} · {r.distanceKm} km · {r.durationMin} min</Cond>
          <Display size={34} color={c.cream} shadow={c.dblue}>{eurShort(r.netCents)}</Display>
          <Cond size={12} color={c.cream}>net pour vous{r.bonusCents > 0 ? ` · dont prime sauveteur ${eurShort(r.bonusCents)}` : ""}</Cond>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Btn label="Je prends" color={c.yel} disabled={busy} onPress={async () => { const x = await act(() => api(`/driver/rescue/${r.id}/accept`, {}), "Mission reprise : elle est dans votre agenda"); if (x?.rideId) onAccepted(x.rideId); }} /></View>
            <View style={{ flex: 1 }}><Btn label="Pas moi" disabled={busy} onPress={() => act(() => api(`/driver/rescue/${r.id}/decline`, {}))} /></View>
          </View>
        </Card>
      ))}

      <Card color={s.listed ? c.yel : c.cream}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Sticker size={56} color={s.listed ? c.red : c.cream} rot={-8}><Slab size={26} color={s.listed ? c.cream : c.ink} shadow={null}>⚑</Slab></Sticker>
          <View style={{ flex: 1 }}>
            <Slab size={18} color={c.ink} shadow={null}>{s.listed ? "Vous êtes sauveteur" : "Les sauveteurs"}</Slab>
            <Cond size={12} color={c.muted}>
              {s.revoked ? "Statut retiré par l'équipe" : s.listed ? `Prime ${eurShort(s.bonusCents)} par mission reprise` : s.eligible ? "Vous remplissez les critères" : "Réservé aux chauffeurs les plus fiables"}
            </Cond>
          </View>
        </View>
        <View style={{ marginTop: 10, gap: 4 }}>
          {s.criteria.map((k: any) => (
            <View key={k.key} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Cond size={12} color={k.ok ? c.ok : c.red}>{k.ok ? "✓" : "✗"} {k.label}</Cond>
              <Cond size={12} color={c.muted}>{k.key === "active" ? k.value : `${k.value} / ${k.required}`}</Cond>
            </View>
          ))}
        </View>
        {s.eligible && !s.revoked && (
          <View style={{ marginTop: 12 }}>
            <Btn label={s.optIn ? "Quitter la liste des sauveteurs" : "Rejoindre la liste des sauveteurs"} color={s.optIn ? c.cream : c.blue} text={s.optIn ? c.ink : c.cream} disabled={busy}
              onPress={() => act(() => api("/driver/rescue/opt-in", { enabled: !s.optIn }), s.optIn ? "Vous n'apparaissez plus dans la liste" : "Vous apparaissez dans la liste des sauveteurs")} />
          </View>
        )}
      </Card>
    </View>
  );
}

const SANCTION_LABEL: Record<string, string> = { SUSPEND_48H: "suspension de 48 h", SUSPEND_7D: "suspension de 7 jours", REVIEW: "examen de votre compte (fermeture possible)" };

/** Coût d'une restitution ou d'un appel à un sauveteur, montré AVANT la décision. */
export function CostNote({ rideId }: { rideId: string }) {
  const q = useFetch<any>(`/driver/rescue/cost?rideId=${rideId}`, 30000);
  const d = q.data;
  if (!d) return null;
  return (
    <Card color={c.cream} style={{ paddingVertical: 12 }}>
      <Cond size={12} color={c.muted}>Annuler maintenant ({d.tier})</Cond>
      <Slab size={15} color={c.red} shadow={null}>Rendre la mission : pénalité {eurShort(d.giveBackCents)}</Slab>
      <Slab size={15} color={c.blue} shadow={null}>Avec un sauveteur : pénalité {eurShort(d.rescueCents)}</Slab>
      <Cond size={12} color={c.muted}>Plus c'est tard, plus c'est cher. Déduit de votre prochain relevé.</Cond>
      {d.sanctionIfGiveBack !== "NONE" && <Cond size={12} color={c.red}>Attention : {SANCTION_LABEL[d.sanctionIfGiveBack]} si vous rendez la mission (récidive).</Cond>}
    </Card>
  );
}

/** Fenêtre « Demander un sauveteur » : liste des sauveteurs disponibles, motif, appel ciblé ou à tous. */
export function RescuePicker({ rideId, onClose, notify }: { rideId: string; onClose: () => void; notify: Notify }) {
  const list = useFetch<any[]>(`/driver/rescue/rescuers?rideId=${rideId}`, 8000);
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ id: string; notified: number; expiresAt: string } | null>(null);

  async function send(targetId?: string) {
    setBusy(true);
    try {
      const r = await api("/driver/rescue/request", { rideId, reason, ...(targetId ? { targetId } : {}) });
      setSent(r);
    } catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!sent) return;
    try { await api(`/driver/rescue/${sent.id}/cancel`, {}); notify("Appel annulé", "ok"); setSent(null); } catch (e: any) { notify(e.message); }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.sky }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Pressable onPress={onClose} accessibilityLabel="Fermer"><Sticker size={44} color={c.cream}><Slab size={20} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
          <Display size={34} shadow={c.red}>Appeler un sauveteur</Display>
          <Cond size={13} color={c.onSky}>Un chauffeur d'élite reprend votre mission : pénalité réduite, mission sauvée.</Cond>

          <CostNote rideId={rideId} />
          {sent ? (
            <Card color={c.yel}>
              <Slab size={18} color={c.ink} shadow={null}>Appel envoyé à {sent.notified} sauveteur(s)</Slab>
              <Cond size={13} color={c.muted}>Réponse attendue avant {timeOf(sent.expiresAt)}. La mission reste la vôtre tant que personne n'accepte : gardez-la sous la main.</Cond>
              <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Btn label="Annuler l'appel" onPress={cancel} /></View>
                <View style={{ flex: 1 }}><Btn label="Fermer" color={c.blue} text={c.cream} onPress={onClose} /></View>
              </View>
            </Card>
          ) : (
            <>
              <Cond size={12} color={c.onSky}>Motif (vu par les sauveteurs)</Cond>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {REASONS.map((r) => <Pressable key={r} onPress={() => setReason(r)}><Chip label={r} color={reason === r ? c.yel : c.cream} /></Pressable>)}
              </View>

              {list.loading ? null : (list.data ?? []).length === 0 ? (
                <Card><Slab size={15} color={c.ink} shadow={null}>Aucun sauveteur disponible pour cette mission pour le moment.</Slab>
                  <Cond size={12} color={c.muted}>Vous pouvez encore « rendre la mission » : le dispatch la propose à tous les chauffeurs.</Cond></Card>
              ) : (
                <>
                  <Btn label={`Appeler tous les sauveteurs (${list.data!.length})`} color={c.red} text={c.cream} disabled={busy} onPress={() => send()} />
                  <Cond size={12} color={c.onSky}>L'appel part d'abord au sauveteur le plus proche du lieu de prise en charge, puis aux suivants à tour de rôle s'il ne répond pas.</Cond>
                  <Cond size={12} color={c.onSky}>Ou choisir un sauveteur (du plus proche au plus éloigné du lieu de prise en charge)</Cond>
                  {list.data!.map((r, i) => (
                    <Card key={r.driverId} onPress={() => !busy && send(r.driverId)} style={{ paddingVertical: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flex: 1 }}>
                          <Slab size={17} color={c.ink} shadow={null}>{i + 1}. {r.name}{i === 0 && r.distanceKm != null ? " · le plus proche" : ""}</Slab>
                          <Cond size={12} color={c.muted}>★ {r.rating.toFixed(2)} · {r.completedRides} missions · {r.distanceKm != null ? `à ${r.distanceKm} km du départ` : "position inconnue"}</Cond>
                        </View>
                        <Chip label="Appeler" color={c.blue} text={c.cream} />
                      </View>
                    </Card>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Justificatif de réservation préalable, à présenter à un agent en cas de contrôle. */
export function JustificatifModal({ rideId, onClose }: { rideId: string; onClose: () => void }) {
  const q = useFetch<any>(`/driver/rides/${rideId}/justificatif`, 60000);
  const j = q.data;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.sky }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Pressable onPress={onClose} accessibilityLabel="Fermer"><Sticker size={44} color={c.cream}><Slab size={20} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
          <Display size={30} shadow={c.red}>Justificatif de réservation</Display>
          <Cond size={12} color={c.onSky}>À présenter en cas de contrôle · {j?.reference ?? ""}</Cond>
          {j && !j.complete && (
            <Card color={c.red}><Slab size={14} color={c.cream} shadow={null}>Incomplet : {j.missing.join(", ")}.</Slab>
              <Cond size={12} color={c.cream}>Renseignez ces informations dans votre profil.</Cond></Card>
          )}
          <Card>
            {(j?.lines ?? []).map(([k, v]: string[]) => (
              <View key={k} style={{ paddingVertical: 6 }}>
                <Cond size={11} color={c.muted}>{k}</Cond>
                <Slab size={15} color={c.ink} shadow={null}>{v}</Slab>
              </View>
            ))}
          </Card>
        </ScrollView>
      </View>
    </Modal>
  );
}
