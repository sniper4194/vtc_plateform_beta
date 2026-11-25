import { Camera, CameraView } from "expo-camera";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Text, TextInput, View } from "react-native";
import ViewShot from "react-native-view-shot";
import { api } from "./api";
import { timeOf } from "./format";
import { PROOF_KIND_LABEL, stampHeader, stampLines } from "./proofFormat";
import { c, font } from "./theme";
import { Btn, Card, Chip, Cond, Display, Slab } from "./ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;
type Kind = "NO_SHOW" | "EXCESS_LUGGAGE" | "OTHER";
interface Fix { lat: number; lng: number; accuracyM: number | null; address: string | null }

/** Adresse lue par le téléphone (service de géocodage inverse du système), sur plusieurs lignes courtes : rue, ville, département, région. */
function formatPlace(a?: Location.LocationGeocodedAddress | null): string | null {
  if (!a) return null;
  const street = [a.streetNumber, a.street].filter(Boolean).join(" ") || a.name || null;
  const parts = [street, a.city ?? a.district, a.subregion, a.region].filter(Boolean) as string[];
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

/** Position en continu, avec l'adresse correspondante (relue quand on s'est déplacé de plus de 60 m). */
function useFix(active: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let stop = false;
    let last: { lat: number; lng: number } | null = null;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { setDenied(true); return; }
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 2000 }, async (p) => {
        if (stop) return;
        const lat = p.coords.latitude, lng = p.coords.longitude, accuracyM = p.coords.accuracy ?? null;
        setFix((f) => ({ lat, lng, accuracyM, address: f?.address ?? null }));
        const moved = !last || Math.hypot((lat - last.lat) * 111_000, (lng - last.lng) * 70_000) > 60;
        if (moved) {
          last = { lat, lng };
          try { const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }); if (!stop) setFix((f) => (f ? { ...f, address: formatPlace(a) } : f)); } catch { /* adresse facultative */ }
        }
      });
    })();
    return () => { stop = true; try { sub?.remove(); } catch { /* le web n'a pas toujours de désabonnement */ } };
  }, [active]);
  return { fix, denied };
}

/** Le cachet (date, adresse, coordonnées) : même rendu sur le viseur et sur l'image envoyée. */
function Stamp({ lines, header }: { lines: string[]; header: string }) {
  const shadow = { textShadowColor: "rgba(0,0,0,0.85)", textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3 } as const;
  return (
    <>
      <View style={{ position: "absolute", top: 10, left: 10, right: 10 }} pointerEvents="none">
        <Text style={{ fontFamily: font.cond, fontSize: 13, letterSpacing: 1, color: "#fff", textTransform: "uppercase", ...shadow }}>{header}</Text>
      </View>
      <View style={{ position: "absolute", right: 10, bottom: 10, left: 90, alignItems: "flex-end" }} pointerEvents="none">
        {lines.map((l, i) => <Text key={i} style={{ fontFamily: font.slab, fontSize: i === 0 ? 15 : 13, color: c.yel, textAlign: "right", ...shadow }}>{l}</Text>)}
      </View>
    </>
  );
}

const W = 360, H = 480; // taille de travail de l'image composée ; exportée en 720 × 960

/** Viseur : date, heure, adresse et position en direct par-dessus la caméra, puis le même cachet incrusté dans la photo. */
/** Ce que la caméra transmet : l'image avec son cachet incrusté, et la position au moment de la prise de vue. */
export interface Shot { image: string; lat: number; lng: number; accuracyM?: number; address?: string; capturedAt: string }

/**
 * Viseur horodaté. Par défaut, envoie une photo-preuve de mission ; avec `onSubmit`, l'image va ailleurs (point de rendez-vous…)
 * et `onSubmit` renvoie le message à afficher.
 */
export function ProofCamera({ rideId, rideRef, kind, onClose, notify, onSent, header: headerText, label, onSubmit }: {
  rideId?: string; rideRef: string; kind: Kind; onClose: () => void; notify: Notify; onSent: () => void;
  header?: string; label?: string; onSubmit?: (s: Shot) => Promise<string>;
}) {
  // Autorisation de la caméra : fonctions directes plutôt que le hook d'expo-camera. Sur certains PC (Windows + pnpm), le hook charge une
  // seconde copie de React et plante (« Cannot read properties of null (reading 'useRef') »).
  const [perm, setPerm] = useState<{ granted: boolean } | null>(null);
  useEffect(() => { Camera.getCameraPermissionsAsync().then(setPerm).catch(() => setPerm({ granted: false })); }, []);
  const askPerm = () => Camera.requestCameraPermissionsAsync().then(setPerm).catch(() => setPerm({ granted: false }));
  const { fix, denied } = useFix(true);
  const cam = useRef<CameraView>(null);
  const shot = useRef<ViewShot>(null);
  const [now, setNow] = useState(new Date());
  const [pic, setPic] = useState<{ uri: string; at: Date; fix: Fix } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const header = headerText ?? stampHeader({ ref: rideRef, kind });
  const live = stampLines({ at: now, lat: fix?.lat ?? null, lng: fix?.lng ?? null, accuracyM: fix?.accuracyM, address: fix?.address });

  async function snap() {
    if (!fix || !cam.current || busy) return;
    setBusy(true);
    try {
      const at = new Date(), frozen = { ...fix };
      const p = await cam.current.takePictureAsync({ quality: 0.6 });
      if (!p) throw new Error("La caméra n'a pas renvoyé de photo");
      setLoaded(false); setPic({ uri: p.uri, at, fix: frozen });
    } catch (e: any) { notify(e.message ?? "Photo impossible"); } finally { setBusy(false); }
  }

  async function send() {
    if (!pic || !shot.current?.capture) return;
    setBusy(true);
    try {
      const image = await shot.current.capture(); // JPEG en base64, cachet incrusté
      if (!image) throw new Error("Image impossible à préparer");
      const payload: Shot = {
        image, lat: pic.fix.lat, lng: pic.fix.lng, ...(pic.fix.accuracyM != null ? { accuracyM: pic.fix.accuracyM } : {}),
        ...(pic.fix.address ? { address: pic.fix.address } : {}), capturedAt: pic.at.toISOString(),
      };
      if (onSubmit) { notify(await onSubmit(payload), "ok"); onSent(); onClose(); return; }
      const r = await api<any>(`/driver/rides/${rideId}/proofs`, { kind, ...payload });
      const warn = r.flags?.length ? ` · ${r.flags[0].label}` : "";
      notify(`Photo enregistrée à ${timeOf(r.receivedAt)} · à ${r.distanceToPickupM} m du lieu de prise en charge${warn}`, r.flags?.length ? "bad" : "ok");
      onSent(); onClose();
    } catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }

  const stamped = pic ? stampLines({ at: pic.at, lat: pic.fix.lat, lng: pic.fix.lng, accuracyM: pic.fix.accuracyM, address: pic.fix.address }) : [];
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {!perm ? <ActivityIndicator color={c.cream} style={{ marginTop: 120 }} /> : !perm.granted ? (
          <View style={{ flex: 1, justifyContent: "center", padding: 28, gap: 14 }}>
            <Display size={30} color={c.cream} shadow={c.red}>Caméra</Display>
            <Slab size={15} color={c.cream} shadow={null}>L'accès à la caméra est nécessaire pour prendre la photo-preuve.</Slab>
            <Btn label="Autoriser la caméra" color={c.yel} onPress={() => askPerm()} />
            <Btn label="Fermer" onPress={onClose} />
          </View>
        ) : pic ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 12 }}>
            <ViewShot ref={shot} options={{ format: "jpg", quality: 0.7, result: "base64", width: W * 2, height: H * 2 }} style={{ width: W, height: H, backgroundColor: "#000" }}>
              <Image source={{ uri: pic.uri }} style={{ width: W, height: H }} resizeMode="cover" onLoad={() => setLoaded(true)} />
              <Stamp lines={stamped} header={header} />
            </ViewShot>
            <View style={{ flexDirection: "row", gap: 12, width: W }}>
              <View style={{ flex: 1 }}><Btn label="Reprendre" onPress={() => setPic(null)} disabled={busy} /></View>
              <View style={{ flex: 2 }}><Btn label={busy ? "Envoi…" : onSubmit ? "Envoyer la photo" : "Envoyer la preuve"} color={c.yel} onPress={send} disabled={busy || !loaded} /></View>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, justifyContent: "center" }}>
              <View style={{ width: "100%", aspectRatio: W / H, alignSelf: "center", overflow: "hidden" }}>
                <CameraView ref={cam} style={{ flex: 1 }} facing="back" />
                <Stamp lines={live} header={header} />
              </View>
            </View>
            <View style={{ padding: 16, gap: 10, backgroundColor: "#000" }}>
              {denied ? <Cond size={12} color={c.yel}>Position refusée : activez la localisation pour prendre une preuve.</Cond>
                : !fix ? <Cond size={12} color={c.yel}>Recherche de la position GPS…</Cond>
                : fix.accuracyM != null && fix.accuracyM > 100 ? <Cond size={12} color={c.yel}>Position imprécise (±{Math.round(fix.accuracyM)} m) : sortez à l'air libre si possible.</Cond> : null}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ width: 110 }}><Btn label="Fermer" onPress={onClose} /></View>
                <Chip label={label ?? PROOF_KIND_LABEL[kind]} color={c.yel} />
                <View style={{ width: 110 }}><Btn label={busy ? "…" : "Photo"} color={c.red} text={c.cream} onPress={snap} disabled={!fix || busy} /></View>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** Dans la mission : les trois types de preuves et la liste de celles déjà envoyées. Visible une fois sur place. */
export function ProofSection({ rideId, rideRef, status, notify }: { rideId: string; rideRef: string; status: string; notify: Notify }) {
  const list = useFetch<any[]>(`/driver/rides/${rideId}/proofs`, 20000);
  const [kind, setKind] = useState<Kind | null>(null);
  if (!["ARRIVED", "IN_PROGRESS", "NO_SHOW", "COMPLETED"].includes(status)) return null;
  const items = list.data ?? [];
  return (
    <View style={{ gap: 8 }}>
      <Cond size={11} color={c.muted}>Preuves sur place</Cond>
      <Card color={c.cream} style={{ gap: 10 }}>
        <Cond size={12} color={c.muted}>Photo horodatée avec votre position, pour justifier un client absent ou des bagages en excès auprès du partenaire.{status === "ARRIVED" ? " Prenez-la avant de déclarer le client absent." : ""}</Cond>
        <View style={{ gap: 8 }}>
          <Btn label="Client absent" color={c.yel} onPress={() => setKind("NO_SHOW")} />
          <Btn label="Bagages en excès" onPress={() => setKind("EXCESS_LUGGAGE")} />
          <Btn label="Autre preuve" onPress={() => setKind("OTHER")} />
        </View>
        {items.map((p) => (
          <View key={p.id} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <Chip label={`${p.label} · ${timeOf(p.receivedAt)}`} color={c.blue} text={c.cream} />
            <Chip label={`à ${p.distanceToPickupM} m`} />
            {p.flags.map((f: any) => <Chip key={f.code} label={f.label} color={c.red} text={c.cream} />)}
          </View>
        ))}
      </Card>
      {kind && (
        <Modal visible animationType="slide" onRequestClose={() => setKind(null)}>
          <ErrorBoundary label="Photo-preuve" onClose={() => setKind(null)}>
            <ProofCamera rideId={rideId} rideRef={rideRef} kind={kind} onClose={() => setKind(null)} notify={notify} onSent={list.reload} />
          </ErrorBoundary>
        </Modal>
      )}
    </View>
  );
}

/**
 * Point de rendez-vous : le chauffeur photographie l'endroit exact où il attend (porte, pilier, panneau). Une fois validé par
 * l'équipe, la photo est montrée aux voyageurs dont la prise en charge est proche, sur leur lien de suivi.
 */
export function MeetingPointSection({ rideRef, status, notify }: { rideRef: string; status: string; notify: Notify }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [camera, setCamera] = useState(false);
  if (!["EN_ROUTE", "ARRIVED"].includes(status)) return null;
  const input = { fontFamily: font.slab, fontSize: 15, color: c.ink, paddingVertical: 6, borderBottomWidth: 2, borderColor: c.ink } as const;
  return (
    <View style={{ gap: 8 }}>
      <Cond size={11} color={c.muted}>Point de rendez-vous</Cond>
      {!open ? (
        <Btn label="Photographier le point de rendez-vous" onPress={() => setOpen(true)} />
      ) : (
        <Card color={c.cream} style={{ gap: 8 }}>
          <Cond size={12} color={c.muted}>Photographiez l'endroit exact où vous attendez : une fois validée par l'équipe, la photo aidera les voyageurs à vous trouver.</Cond>
          <TextInput style={input} value={label} onChangeText={setLabel} placeholder="Ex. : Terminal 2E, porte 8" placeholderTextColor="#9a9ab0" maxLength={80} />
          <TextInput style={input} value={note} onChangeText={setNote} placeholder="Indication (facultatif) : à droite du café…" placeholderTextColor="#9a9ab0" maxLength={300} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Btn label="Annuler" onPress={() => setOpen(false)} /></View>
            <View style={{ flex: 2 }}><Btn label="Prendre la photo" color={c.yel} disabled={label.trim().length < 3} onPress={() => setCamera(true)} /></View>
          </View>
        </Card>
      )}
      {camera && (
        <Modal visible animationType="slide" onRequestClose={() => setCamera(false)}>
          <ErrorBoundary label="Point de rendez-vous" onClose={() => setCamera(false)}>
            <ProofCamera
              rideRef={rideRef} kind="OTHER" header={`CliCab · Point de rendez-vous · ${label.trim()}`} label="Point de rendez-vous"
              onClose={() => setCamera(false)} notify={notify} onSent={() => { setOpen(false); setLabel(""); setNote(""); }}
              onSubmit={async (s) => {
                await api("/driver/meeting-points", { label: label.trim(), ...(note.trim() ? { note: note.trim() } : {}), image: s.image, lat: s.lat, lng: s.lng, ...(s.accuracyM != null ? { accuracyM: s.accuracyM } : {}) });
                return "Merci ! Le point sera montré aux voyageurs après validation par l'équipe.";
              }}
            />
          </ErrorBoundary>
        </Modal>
      )}
    </View>
  );
}
