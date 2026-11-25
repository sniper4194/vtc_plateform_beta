import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as Location from "expo-location";
import { AlfaSlabOne_400Regular } from "@expo-google-fonts/alfa-slab-one";
import { Anton_400Regular } from "@expo-google-fonts/anton";
import { KaushanScript_400Regular } from "@expo-google-fonts/kaushan-script";
import { RozhaOne_400Regular } from "@expo-google-fonts/rozha-one";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { api, getApiUrl, loadApiUrl, loadToken, saveApiUrl, saveToken } from "./src/api";
import { reportCrash } from "./src/crashReport";
import { ErrorBoundary } from "./src/ErrorBoundary";
import { requestDriverNotifications } from "./src/driverNotifications";
import { useLandingAlert } from "./src/useLandingAlert";
import { SpotPrompt } from "./src/identity";
import { MissionScreen } from "./src/mission";
import { Earnings } from "./src/earnings";
import { Agenda, Cap, Messages, Radar } from "./src/screens";
import { applyTheme, BRAND, c, font, type ThemeMode, type ThemeStyle } from "./src/theme";
import { loadThemeMode, loadThemeStyle, saveThemeMode, saveThemeStyle } from "./src/themeStore";
import { ThemeChoice } from "./src/ThemeChoice";
import { Btn, Card, Cond, Display, Script, Slab, Sticker, ThemePickerButton, ThemeToggle, useToast } from "./src/ui";

type Tab = "radar" | "cap" | "revenus" | "agenda";

function LoginField({ label, classic, children }: { label: string; classic: boolean; children: ReactNode }) {
  if (!classic) return <Card><Cond size={12} color={c.muted}>{label}</Cond>{children}</Card>;
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: c.muted }}>{label}</Text>
      <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 14 }}>{children}</View>
    </View>
  );
}

function Login({ onDone, dark, onToggleTheme, onChooseTheme, classic }: {
  onDone: () => void; dark: boolean; onToggleTheme: () => void; onChooseTheme: () => void; classic: boolean;
}) {
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
  const input = { fontFamily: font.slab, fontSize: classic ? 16 : 18, color: c.ink, paddingVertical: classic ? 13 : 4 } as const;
  const serverInput = <TextInput style={input} placeholder="http://192.168.1.20:3000" placeholderTextColor={classic ? c.muted : "#9a9ab0"} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={draft} onChangeText={setDraft} />;
  const serverActions = (
    <View style={{ flexDirection: "row", gap: 10, marginTop: classic ? 0 : 8 }}>
      <View style={{ flex: 1 }}><Btn label="Enregistrer" onPress={saveServer} color={c.yel} /></View>
      <View style={{ flex: 1 }}><Btn label="Annuler" onPress={() => { setEditing(false); setErr(""); }} /></View>
    </View>
  );
  const form = (
    <>
      {step === "phone" ? (
        <>
          <LoginField label="Téléphone" classic={classic}>
            <TextInput style={input} placeholder="06 12 34 56 78" placeholderTextColor={classic ? c.muted : "#9a9ab0"} keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoCapitalize="none" autoComplete="tel" />
          </LoginField>
          {err ? <Card color={c.red}><Slab size={14} color={c.cream} shadow={null}>{err}</Slab></Card> : null}
          <Btn label={busy ? "Envoi…" : "Recevoir mon code"} onPress={sendCode} disabled={busy || phone.trim().length < 6} color={c.yel} />
        </>
      ) : (
        <>
          {classic
            ? <Text style={{ fontSize: 14, color: c.muted }}>Code envoyé par SMS au {phone.trim()}</Text>
            : <Cond size={13} color={c.onSky}>Code envoyé par SMS au {phone.trim()}</Cond>}
          <LoginField label="Code à 6 chiffres" classic={classic}>
            <TextInput style={input} placeholder="••••••" placeholderTextColor={classic ? c.muted : "#9a9ab0"} keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" />
          </LoginField>
          {err ? <Card color={c.red}><Slab size={14} color={c.cream} shadow={null}>{err}</Slab></Card> : null}
          <Btn label={busy ? "Connexion…" : "C'est parti"} onPress={submit} disabled={busy || code.trim().length < 4} color={c.yel} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Btn label={wait > 0 ? `Renvoyer (${wait} s)` : "Renvoyer le code"} onPress={sendCode} disabled={busy || wait > 0} /></View>
            <View style={{ flex: 1 }}><Btn label="Changer de numéro" onPress={() => { setStep("phone"); setErr(""); }} /></View>
          </View>
        </>
      )}
      {editing ? (
        classic
          ? <View style={{ gap: 8 }}><LoginField label="Adresse du serveur" classic>{serverInput}</LoginField>{serverActions}</View>
          : <Card><Cond size={12} color={c.muted}>Adresse du serveur</Cond>{serverInput}{serverActions}</Card>
      ) : (
        <Pressable onPress={() => { setDraft(server); setEditing(true); }} accessibilityRole="button" accessibilityLabel="Changer le serveur">
          {classic
            ? <Text style={{ fontSize: 12, color: c.muted }}>Serveur : {server} (changer)</Text>
            : <Cond size={11} color={c.onSky}>Serveur : {server} (changer)</Cond>}
        </Pressable>
      )}
      <ThemePickerButton onPress={onChooseTheme} color={classic ? c.blue : c.onSky} />
    </>
  );

  if (classic) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.frame }}>
        <StatusBar style="light" backgroundColor={c.frame} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={{ margin: 10, borderRadius: 28, backgroundColor: c.cream }} keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 25, paddingTop: 32, paddingBottom: 30 }}>
            <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 20 }}>
              <View style={{ alignItems: "center", gap: 5, paddingBottom: 23, borderBottomWidth: 1, borderColor: c.line }}>
                <Text style={{ color: c.blue, fontSize: 34, fontWeight: "700", letterSpacing: -1.1 }}>{BRAND}</Text>
                <Text style={{ color: c.muted, fontSize: 11, fontWeight: "700", letterSpacing: 2 }}>ESPACE CHAUFFEUR</Text>
              </View>
              <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 28, fontWeight: "800" }}>Bon retour !</Text>
              {form}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sky }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={{ position: "absolute", top: -40, right: -50 }}><Sticker size={190} color={c.yel} rot={12}><Display size={60} color={c.blue} shadow={c.red}>V</Display></Sticker></View>
      <View style={{ position: "absolute", bottom: -60, left: -60 }}><Sticker size={220} color={c.red} rot={-10}><Slab size={22} color={c.yel} shadow={null}>PRIX FIXE</Slab></Sticker></View>
      <View style={{ position: "absolute", top: 14, left: 16, zIndex: 5 }}><ThemeToggle dark={dark} onToggle={onToggleTheme} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 90, gap: 18 }}>
        <View>
          <Display size={70} shadow={c.red}>{BRAND}</Display>
          <Script size={34}>l'app des chauffeurs</Script>
        </View>
        {form}
      </ScrollView>
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
  const [style, setStyle] = useState<ThemeStyle | null>(null);
  const [choosingTheme, setChoosingTheme] = useState(false);
  const [fontsLoaded] = useFonts({ RozhaOne_400Regular, AlfaSlabOne_400Regular, Anton_400Regular, KaushanScript_400Regular });
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [tab, setTab] = useState<Tab>("cap");
  const [missionId, setMissionId] = useState<string | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const toast = useToast();
  useLandingAlert(authed && notificationsReady, toast.show);

  useEffect(() => {
    Promise.all([loadThemeMode(), loadThemeStyle(), loadApiUrl().then(() => loadToken())]).then(([m, preferred, token]) => {
      applyTheme(m, preferred ?? "original");
      setMode(m);
      setStyle(preferred);
      setAuthed(Boolean(token));
      setReady(true);
    });
  }, []);
  const hasStyle = style !== null;
  useEffect(() => {
    if (!ready || !fontsLoaded || !hasStyle) return;
    let active = true;
    void requestDriverNotifications().finally(() => {
      if (active) setNotificationsReady(true);
    });
    return () => { active = false; };
  }, [ready, fontsLoaded, hasStyle]);
  // Les couleurs sont lues à chaque rendu : on change la palette puis on remonte l'arbre (clé = thème) pour tout repeindre.
  const dark = mode === "dark";
  const classic = style === "classic";
  const openThemeChoice = () => setChoosingTheme(true);
  function selectTheme(next: ThemeStyle) {
    applyTheme(mode, next);
    setStyle(next);
    setChoosingTheme(false);
    void saveThemeStyle(next);
  }
  function toggleTheme() {
    const next: ThemeMode = dark ? "light" : "dark";
    applyTheme(next, style ?? "original"); setMode(next); void saveThemeMode(next);
  }

  // Position envoyée toutes les 30 s pour trier les offres par proximité.
  useEffect(() => {
    if (!authed || !notificationsReady) return;
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
  }, [authed, notificationsReady]);

  if (!ready || !fontsLoaded) return <View style={{ flex: 1, backgroundColor: c.sky, justifyContent: "center" }}><ActivityIndicator color={c.onSky} /></View>;
  if (!style) return <ThemeChoice selected={null} onSelect={selectTheme} />;
  const themePicker = choosingTheme && (
    <Modal visible animationType="fade" onRequestClose={() => setChoosingTheme(false)}>
      <ThemeChoice selected={style} onSelect={selectTheme} onClose={() => setChoosingTheme(false)} />
    </Modal>
  );
  if (!authed) return (
    <>
      <Login classic={classic} onDone={() => setAuthed(true)} dark={dark} onToggleTheme={toggleTheme} onChooseTheme={openThemeChoice} />
      {themePicker}
    </>
  );
  if (showMessages) {
    return (
      <SafeAreaView key={`${style}:${mode}`} style={{ flex: 1, backgroundColor: c.sky }}>
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
        <StatusBar style={classic && !dark ? "dark" : "light"} />
        <MissionScreen rideId={missionId} onClose={() => setMissionId(null)} notify={toast.show} />
        {toast.node}
        <SpotPrompt notify={toast.show} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView key={`${style}:${mode}`} style={{ flex: 1, backgroundColor: c.sky }}>
      <StatusBar style={classic && !dark ? "dark" : "light"} />
      <View style={{ flex: 1 }}>
        {tab === "radar" && <Radar notify={toast.show} />}
        {tab === "cap" && <Cap dark={dark} onToggleTheme={toggleTheme} onChooseTheme={openThemeChoice} goRadar={() => setTab("radar")} onQuit={async () => { await saveToken(null); setAuthed(false); }} notify={toast.show} openMission={setMissionId} openMessages={() => setShowMessages(true)} />}
        {tab === "revenus" && <Earnings notify={toast.show} />}
        {tab === "agenda" && <Agenda notify={toast.show} openMission={setMissionId} />}
        {toast.node}
        <SpotPrompt notify={toast.show} />
      </View>
      <View style={{ flexDirection: "row", backgroundColor: c.cream, borderTopWidth: classic ? 1 : 3, borderColor: c.line, paddingVertical: 8 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={{ flex: 1, alignItems: "center", gap: 2 }} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Sticker size={38} color={tab === t.key ? c.yel : c.cream} rot={tab === t.key ? -8 : 0}><Slab size={17} color={tab === t.key ? c.ink : c.muted} shadow={null}>{t.glyph}</Slab></Sticker>
            <Cond size={12} color={tab === t.key ? (classic ? c.blue : c.red) : c.muted}>{t.label}</Cond>
          </Pressable>
        ))}
      </View>
      {themePicker}
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
