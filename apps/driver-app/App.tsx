import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as Location from "expo-location";
import { AlfaSlabOne_400Regular } from "@expo-google-fonts/alfa-slab-one";
import { Anton_400Regular } from "@expo-google-fonts/anton";
import { KaushanScript_400Regular } from "@expo-google-fonts/kaushan-script";
import { RozhaOne_400Regular } from "@expo-google-fonts/rozha-one";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, TextInput, View } from "react-native";
import { api, getApiUrl, loadApiUrl, loadToken, saveApiUrl, saveToken } from "./src/api";
import { reportCrash } from "./src/crashReport";
import { ErrorBoundary } from "./src/ErrorBoundary";
import { useLandingAlert } from "./src/useLandingAlert";
import { SpotPrompt } from "./src/identity";
import { MissionScreen } from "./src/mission";
import { Earnings } from "./src/earnings";
import { Agenda, Cap, Messages, Radar } from "./src/screens";
import { applyTheme, BRAND, c, font, type ThemeMode } from "./src/theme";
import { loadThemeMode, saveThemeMode } from "./src/themeStore";
import { Btn, Card, Cond, Display, Script, Slab, Sticker, ThemeToggle, useToast } from "./src/ui";

type Tab = "radar" | "cap" | "revenus" | "agenda";

function Login({ onDone, dark, onToggleTheme }: { onDone: () => void; dark: boolean; onToggleTheme: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [wait, setWait] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(getApiUrl());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  async function saveServer() {
    try { setServer(await saveApiUrl(draft)); setEditing(false); setErr(""); } catch (e: any) { setErr(e.message); }
  }

  // Délai avant de pouvoir redemander un code (le serveur applique aussi sa propre limite).
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function sendCode() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ resendInSeconds: number }>("/driver/otp", { phone: phone.trim() });
      setStep("code"); setCode(""); setWait(r.resendInSeconds ?? 30);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ token: string }>("/driver/login", { phone: phone.trim(), code: code.trim() });
      await saveToken(r.token);
      onDone();
    } catch (e: any) { setErr(e.message === "Identifiants invalides" ? "Code incorrect ou expiré" : e.message); } finally { setBusy(false); }
  }
  const input = { fontFamily: font.slab, fontSize: 18, color: c.ink, paddingVertical: 4 } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sky }}>
      <View style={{ position: "absolute", top: -40, right: -50 }}><Sticker size={190} color={c.yel} rot={12}><Display size={60} color={c.blue} shadow={c.red}>V</Display></Sticker></View>
      <View style={{ position: "absolute", bottom: -60, left: -60 }}><Sticker size={220} color={c.red} rot={-10}><Slab size={22} color={c.yel} shadow={null}>PRIX FIXE</Slab></Sticker></View>
      <View style={{ position: "absolute", top: 14, left: 16, zIndex: 5 }}><ThemeToggle dark={dark} onToggle={onToggleTheme} /></View>
      <View style={{ padding: 24, marginTop: 90, gap: 18 }}>
        <View>
          <Display size={70} shadow={c.red}>{BRAND}</Display>
          <Script size={34}>l'app des chauffeurs</Script>
        </View>
        {step === "phone" ? (
          <>
            <Card>
              <Cond size={12} color={c.muted}>Téléphone</Cond>
              <TextInput style={input} placeholder="06 12 34 56 78" placeholderTextColor="#9a9ab0" keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoCapitalize="none" autoComplete="tel" />
            </Card>
            {err ? <Card color={c.red}><Slab size={14} color={c.cream} shadow={null}>{err}</Slab></Card> : null}
            <Btn label={busy ? "Envoi…" : "Recevoir mon code"} onPress={sendCode} disabled={busy || phone.trim().length < 6} color={c.yel} />
          </>
        ) : (
          <>
            <Cond size={13} color={c.onSky}>Code envoyé par SMS au {phone.trim()}</Cond>
            <Card>
              <Cond size={12} color={c.muted}>Code à 6 chiffres</Cond>
              <TextInput style={input} placeholder="••••••" placeholderTextColor="#9a9ab0" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" />
            </Card>
            {err ? <Card color={c.red}><Slab size={14} color={c.cream} shadow={null}>{err}</Slab></Card> : null}
            <Btn label={busy ? "Connexion…" : "C'est parti"} onPress={submit} disabled={busy || code.trim().length < 4} color={c.yel} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}><Btn label={wait > 0 ? `Renvoyer (${wait} s)` : "Renvoyer le code"} onPress={sendCode} disabled={busy || wait > 0} /></View>
              <View style={{ flex: 1 }}><Btn label="Changer de numéro" onPress={() => { setStep("phone"); setErr(""); }} /></View>
            </View>
          </>
        )}
        {editing ? (
          <Card>
            <Cond size={12} color={c.muted}>Adresse du serveur</Cond>
            <TextInput style={input} placeholder="http://192.168.1.20:3000" placeholderTextColor="#9a9ab0" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={draft} onChangeText={setDraft} />
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Btn label="Enregistrer" onPress={saveServer} color={c.yel} /></View>
              <View style={{ flex: 1 }}><Btn label="Annuler" onPress={() => { setEditing(false); setErr(""); }} /></View>
            </View>
          </Card>
        ) : (
          <Pressable onPress={() => { setDraft(server); setEditing(true); }} accessibilityLabel="Changer le serveur">
            <Cond size={11} color={c.onSky}>Serveur : {server} (changer)</Cond>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const TABS: { key: Tab; label: string; glyph: string }[] = [
  { key: "radar", label: "Radar", glyph: "◎" },
  { key: "cap", label: "Cap", glyph: "★" },
  { key: "revenus", label: "Revenus", glyph: "€" },
  { key: "agenda", label: "Agenda", glyph: "▦" },
];

function Root() {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [fontsLoaded] = useFonts({ RozhaOne_400Regular, AlfaSlabOne_400Regular, Anton_400Regular, KaushanScript_400Regular });
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("cap");
  const [missionId, setMissionId] = useState<string | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const toast = useToast();
  useLandingAlert(authed, toast.show);

  useEffect(() => {
    Promise.all([loadThemeMode(), loadApiUrl().then(() => loadToken())]).then(([m, t]) => { applyTheme(m); setMode(m); setAuthed(Boolean(t)); setReady(true); });
  }, []);
  // Les couleurs sont lues à chaque rendu : on change la palette puis on remonte l'arbre (clé = thème) pour tout repeindre.
  const dark = mode === "dark";
  function toggleTheme() {
    const next: ThemeMode = dark ? "light" : "dark";
    applyTheme(next); setMode(next); void saveThemeMode(next);
  }

  // Position envoyée toutes les 30 s pour trier les offres par proximité.
  useEffect(() => {
    if (!authed) return;
    let stop = false;
    async function ping() {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || stop) return;
        const p = await Location.getCurrentPositionAsync({});
        await api("/driver/location", { lat: p.coords.latitude, lng: p.coords.longitude });
      } catch { /* position facultative */ }
    }
    ping();
    const t = setInterval(ping, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [authed]);

  if (!ready || !fontsLoaded) return <View style={{ flex: 1, backgroundColor: c.sky, justifyContent: "center" }}><ActivityIndicator color={c.onSky} /></View>;
  if (!authed) return <Login key={mode} onDone={() => setAuthed(true)} dark={dark} onToggleTheme={toggleTheme} />;
  if (showMessages) {
    return (
      <SafeAreaView key={mode} style={{ flex: 1, backgroundColor: c.sky }}>
        <StatusBar style={dark ? "light" : "dark"} />
        <Messages onClose={() => setShowMessages(false)} notify={toast.show} openMission={setMissionId} />
        {toast.node}
        <SpotPrompt notify={toast.show} />
      </SafeAreaView>
    );
  }
  if (missionId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.sky }}>
        <StatusBar style="light" />
        <MissionScreen rideId={missionId} onClose={() => setMissionId(null)} notify={toast.show} />
        {toast.node}
        <SpotPrompt notify={toast.show} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView key={mode} style={{ flex: 1, backgroundColor: c.sky }}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        {tab === "radar" && <Radar notify={toast.show} />}
        {tab === "cap" && <Cap dark={dark} onToggleTheme={toggleTheme} goRadar={() => setTab("radar")} onQuit={async () => { await saveToken(null); setAuthed(false); }} notify={toast.show} openMission={setMissionId} openMessages={() => setShowMessages(true)} />}
        {tab === "revenus" && <Earnings notify={toast.show} />}
        {tab === "agenda" && <Agenda notify={toast.show} openMission={setMissionId} />}
        {toast.node}
        <SpotPrompt notify={toast.show} />
      </View>
      <View style={{ flexDirection: "row", backgroundColor: c.cream, borderTopWidth: 3, borderColor: c.ink, paddingVertical: 8 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={{ flex: 1, alignItems: "center", gap: 2 }} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Sticker size={38} color={tab === t.key ? c.yel : c.cream} rot={tab === t.key ? -8 : 0}><Slab size={17} color={tab === t.key ? c.ink : c.muted} shadow={null}>{t.glyph}</Slab></Sticker>
            <Cond size={12} color={tab === t.key ? c.red : c.muted}>{t.label}</Cond>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

// Erreurs JavaScript hors affichage (événements, promesses…) : signalées à l'équipe avant de laisser le comportement habituel.
const errorUtils = (globalThis as any).ErrorUtils;
if (errorUtils?.setGlobalHandler) {
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((e: unknown, isFatal?: boolean) => { reportCrash(e, "global", Boolean(isFatal)); previous?.(e, isFatal); });
}

export default function App() {
  return <ErrorBoundary label="Application"><Root /></ErrorBoundary>;
}
