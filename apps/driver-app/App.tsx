import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as Location from "expo-location";
import { AlfaSlabOne_400Regular } from "@expo-google-fonts/alfa-slab-one";
import { Anton_400Regular } from "@expo-google-fonts/anton";
import { KaushanScript_400Regular } from "@expo-google-fonts/kaushan-script";
import { RozhaOne_400Regular } from "@expo-google-fonts/rozha-one";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { api, ApiError, BiometricError, biometricAvailable, biometricUnavailableMessage, clearSession, getApiUrl, loadApiUrl, loadDevice, loadToken, logout, saveApiUrl, saveDevice, saveHybridToken, unlockBiometric, verifySession } from "./src/api";
import { reportCrash } from "./src/crashReport";
import { ErrorBoundary } from "./src/ErrorBoundary";
import { requestDriverNotifications } from "./src/driverNotifications";
import { useLandingAlert } from "./src/useLandingAlert";
import { SpotPrompt } from "./src/identity";
import { MissionScreen } from "./src/mission";
import { Earnings } from "./src/earnings";
import { Agenda, Cap, Messages, Radar } from "./src/screens";
import { applyTheme, BRAND, c, type ThemeMode } from "./src/theme";
import { loadThemeMode, saveThemeMode } from "./src/themeStore";
import { passwordRules, validNewPassword } from "./src/password-policy";
import { Btn, Card, Cond, Display, Script, Slab, Sticker, ThemeToggle, useToast } from "./src/ui";

type Tab = "radar" | "cap" | "revenus" | "agenda";

function PasswordField({ label, value, onChange, isNew = false, disabled }: { label: string; value: string; onChange: (v: string) => void; isNew?: boolean; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state !== "active") setVisible(false); });
    return () => sub.remove();
  }, []);
  return <View style={{ gap: 5 }}>
    <Text style={{ color: c.ink, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: c.ink, borderRadius: 12, backgroundColor: c.white }}>
      <TextInput style={{ flex: 1, minWidth: 0, color: c.ink, fontSize: 17, paddingHorizontal: 12, paddingVertical: 12 }} accessibilityLabel={label} secureTextEntry={!visible} value={value} onChangeText={onChange} maxLength={128} autoCapitalize="none" autoCorrect={false} autoComplete={isNew ? "new-password" : "current-password"} editable={!disabled}/>
      <Pressable accessibilityRole="button" accessibilityLabel={visible ? "Masquer " + label.toLowerCase() : "Afficher " + label.toLowerCase()} accessibilityState={{ disabled }} disabled={disabled} onPress={() => setVisible(v => !v)} style={{ width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 24, height: 15, borderRadius: 12, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.ink }}/>
          {visible && <View style={{ position: "absolute", width: 27, height: 2, backgroundColor: c.ink, transform: [{ rotate: "-40deg" }] }}/>}
        </View>
      </Pressable>
    </View>
  </View>;
}

function Login({ onDone, dark, onToggleTheme, sessionExpired }: { onDone: () => void; dark: boolean; onToggleTheme: () => void; sessionExpired: boolean }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [method,setMethod]=useState<"password"|"activate"|"legacy">("password");
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [bio,setBio]=useState(false);
  const [bioAvailable, setBioAvailable] = useState(biometricAvailable);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [challenge,setChallenge]=useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") setBioAvailable(biometricAvailable());
    });
    return () => subscription.remove();
  }, []);
  function choose(m:typeof method){setMethod(m);setStep("phone");setCode("");setPassword("");setConfirmPassword("");setChallenge(false);setPendingToken(null);setErr("");}
  async function finish(r: { token: string; deviceKey?: string }) {
    if (r.deviceKey) {
      try { await saveDevice(r.deviceKey); }
      catch { throw new Error("Impossible de mémoriser cet appareil. Reconnectez-vous avec votre mot de passe."); }
    }
    try {
      await saveHybridToken(r.token, bio);
    } catch (error) {
      if (error instanceof BiometricError) {
        setPendingToken(r.token);
        setPassword("");
        setConfirmPassword("");
      }
      throw error;
    }
    onDone();
  }
  async function finishPending(biometric: boolean) {
    if (!pendingToken) return;
    setBusy(true);
    setErr("");
    try {
      await verifySession(pendingToken);
      await saveHybridToken(pendingToken, biometric);
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        choose("password");
        setErr("Votre session a expiré ou a été révoquée. Reconnectez-vous.");
      } else {
        setErr(error instanceof Error ? error.message : "Connexion impossible. Réessayez.");
      }
    } finally {
      setBusy(false);
    }
  }
  async function passwordLogin(){setBusy(true);setErr("");try{const key=await loadDevice();const r=await api<{token?:string;deviceKey?:string;requiresSms?:boolean}>("/driver/auth/password",{phone:phone.trim(),password,...(key?{deviceKey:key}:{}),...(step==="code"?{code:code.trim()}:{})});if(r.requiresSms){setChallenge(true);return;}if(!r.token)throw new Error("Session non reçue");await finish({token:r.token,deviceKey:r.deviceKey});}catch(e:any){setErr(e.message);}finally{setBusy(false);}}
  async function biometricLogin() {
    setBusy(true);
    setErr("");
    try {
      if (await unlockBiometric()) onDone();
      else setErr("Aucune session biométrique utilisable. Connectez-vous avec votre mot de passe pour réactiver la biométrie.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Impossible de déverrouiller la session.");
    } finally {
      setBusy(false);
    }
  }
  const [wait, setWait] = useState(0);
  const [err, setErr] = useState(sessionExpired ? "Votre session a expiré ou a été révoquée. Reconnectez-vous." : "");
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(getApiUrl());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  async function saveServer() {
    if (busy || pendingToken) return;
    try { setServer(await saveApiUrl(draft)); setEditing(false); setErr(""); } catch (e: any) { setErr(e.message); }
  }

  // Délai avant de pouvoir redemander un code (le serveur applique aussi sa propre limite).
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function sendCode() {
    if(method==="activate"&&(!validNewPassword(password)||password!==confirmPassword)){setErr("Respectez les critères du mot de passe et confirmez-le.");return;}
    setBusy(true); setErr("");
    try {
      const r = await api<{ resendInSeconds: number }>(method==="password"?"/driver/auth/device-code":"/driver/otp", { phone: phone.trim(),...(method==="password"?{password}:{}) });
      setStep("code"); setCode(""); setWait(r.resendInSeconds ?? 30);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setErr("");
    try {
      if(method==="activate"){if(!validNewPassword(password)||password!==confirmPassword)throw new Error("Respectez les critères du mot de passe et confirmez-le.");const r=await api<{token:string;deviceKey:string}>("/driver/auth/activate",{phone:phone.trim(),code:code.trim(),password});await finish(r);}
      else {const r=await api<{ token: string }>("/driver/login", { phone: phone.trim(), code: code.trim() });await saveHybridToken(r.token, false);onDone();}
    } catch (e: any) { setErr(e.message === "Identifiants invalides" ? "Code incorrect ou expiré" : e.message); } finally { setBusy(false); }
  }
  const input = { fontSize: 18, color: c.ink, paddingVertical: 10 } as const;
  const passwordReady=validNewPassword(password)&&password===confirmPassword;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sky }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingTop: 32, gap: 16, paddingBottom: 48 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Display size={42} shadow={c.red}>{BRAND}</Display>
            <Script size={25}>L'app des chauffeurs</Script>
          </View>
          <ThemeToggle dark={dark} onToggle={onToggleTheme} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ color: c.onSky, fontSize: 24, fontWeight: "700" }}>{step==="code"?"Vérification SMS":method==="activate"?"Activer mon compte":method==="legacy"?"Connexion par code":"Bienvenue"}</Text>
          <Text style={{ color: c.onSky, fontSize: 14 }}>{step==="code"?"Saisissez le code à 6 chiffres.":"Accédez à votre espace chauffeur sécurisé."}</Text>
        </View>
        {!pendingToken&&step==="phone"&&<View style={{ flexDirection: "row", gap: 8 }}>
          {(["password","activate"] as const).map(m=><Pressable key={m} accessibilityRole="tab" accessibilityState={{selected:method===m,disabled:busy}} disabled={busy} onPress={()=>choose(m)} style={{ flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 2, borderColor: c.ink, backgroundColor: method===m?c.yel:c.cream, justifyContent:"center", alignItems:"center", padding:8 }}>
            <Text style={{ color:c.ink, fontSize:14, fontWeight:"700", textAlign:"center" }}>{m==="password"?"Mot de passe":"Activer mon compte"}</Text>
          </Pressable>)}
        </View>}
        {pendingToken ? (
          <>
            {err ? <Card color={c.red}><Text style={{color:c.white,fontSize:14,fontWeight:"600"}}>{err}</Text></Card> : null}
            <Btn label="Continuer avec une connexion classique" disabled={busy} onPress={() => finishPending(false)} color={c.yel} />
            {bioAvailable && <Btn label="Réessayer la biométrie" disabled={busy} onPress={() => finishPending(true)} />}
            <Btn label="Revenir à la connexion" disabled={busy} onPress={() => choose("password")} />
          </>
        ) : step === "phone" ? (
          <>
            <Card>
              <Cond size={12} color={c.muted}>Téléphone</Cond>
              <TextInput style={input} placeholder="06 12 34 56 78" placeholderTextColor="#9a9ab0" keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoCapitalize="none" autoComplete="tel" />
            </Card>
            {method==="password"&&<Card><PasswordField key="login" label="Mot de passe" value={password} onChange={v=>{setPassword(v);setChallenge(false);}} disabled={busy}/></Card>}
            {method==="activate"&&<Card style={{ gap: 12 }}>
              <Text style={{ color:c.ink, fontSize:13 }}>Première activation ou récupération autorisée par le support.</Text>
              <PasswordField key="new" label="Nouveau mot de passe" value={password} onChange={setPassword} isNew disabled={busy}/>
              <View style={{ gap: 5 }}>
                {passwordRules.map(rule=><Text key={rule.label} style={{ color:rule.test(password)?"#17663d":c.muted, fontSize:13 }}>{rule.test(password)?"✓":"○"}  {rule.label}</Text>)}
              </View>
              <PasswordField key="confirm" label="Confirmer le mot de passe" value={confirmPassword} onChange={setConfirmPassword} isNew disabled={busy}/>
              <Text style={{ color:password&&password===confirmPassword?"#17663d":c.muted, fontSize:13 }}>{password&&password===confirmPassword?"✓":"○"}  Les deux mots de passe correspondent</Text>
            </Card>}
            {method !== "legacy" && (bioAvailable || bio) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ flex: 1, color: c.onSky, fontSize: 14 }}>Protéger ma session par biométrie</Text>
                <Switch accessibilityLabel="Protéger ma session par biométrie" value={bio} disabled={busy}
                  onValueChange={value => {
                    if (!value || biometricAvailable()) {
                      setBio(value);
                      setErr("");
                    } else {
                      setBioAvailable(false);
                      setErr(biometricUnavailableMessage);
                    }
                  }} />
              </View>
            )}
            {err ? <Card color={c.red}><Text style={{color:c.white,fontSize:14,fontWeight:"600"}}>{err}</Text></Card> : null}
            {method==="password"?<><Btn label={busy?"Connexion…":bio?"Se connecter et activer la biométrie":"Se connecter avec le mot de passe"} onPress={passwordLogin} disabled={busy||phone.trim().length<6||!password} color={c.yel}/>{challenge&&<><Text style={{color:c.onSky,fontSize:14}}>Nouvel appareil ou autorisation expirée. Confirmez votre numéro par SMS.</Text><Btn label="Vérifier cet appareil par SMS" onPress={sendCode} disabled={busy||wait>0||!password}/></>}<Text style={{color:c.onSky,fontSize:13}}>Mot de passe oublié ? Contactez le support pour vérifier votre identité, puis activez de nouveau votre compte.</Text>{bioAvailable&&<Btn label="Déverrouillage biométrique" disabled={busy} onPress={biometricLogin}/>}<Btn label="Ancien compte ? Recevoir mon code SMS" disabled={busy||phone.trim().length<6} onPress={()=>{setMethod("legacy");setPassword("");setConfirmPassword("");setChallenge(false);setErr("");void (async()=>{setBusy(true);try{const r=await api<{resendInSeconds:number}>("/driver/otp",{phone:phone.trim()});setStep("code");setCode("");setWait(r.resendInSeconds??30);}catch(e:any){setErr(e.message);}finally{setBusy(false);}})();}}/></>:<Btn label={busy?"Envoi…":"Recevoir mon code"} onPress={sendCode} disabled={busy||phone.trim().length<6||method==="activate"&&!passwordReady||wait>0} color={c.yel}/>}
            {method!=="legacy"&&Platform.OS!=="web"&&!bioAvailable&&<Text style={{color:c.onSky,fontSize:13}}>{biometricUnavailableMessage}</Text>}
            {method==="password"&&<Text style={{color:c.onSky,fontSize:12}}>Le code SMS seul est réservé aux comptes non activés.</Text>}
          </>
        ) : (
          <>
            <Cond size={13} color={c.onSky}>Code envoyé par SMS au {phone.trim()}</Cond>
            <Card>
              <Cond size={12} color={c.muted}>Code à 6 chiffres</Cond>
              <TextInput style={input} placeholder="••••••" placeholderTextColor="#9a9ab0" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" />
            </Card>
            {err ? <Card color={c.red}><Text style={{color:c.white,fontSize:14,fontWeight:"600"}}>{err}</Text></Card> : null}
            <Btn label={busy ? "Connexion…" : "C'est parti"} onPress={method==="password"?passwordLogin:submit} disabled={busy || code.trim().length !== 6} color={c.yel} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}><Btn label={wait > 0 ? `Renvoyer (${wait} s)` : "Renvoyer le code"} onPress={sendCode} disabled={busy || wait > 0} /></View>
              <View style={{ flex: 1 }}><Btn label="Changer de numéro" onPress={() => { setStep("phone"); setErr(""); setChallenge(false); setCode(""); }} /></View>
            </View>
          </>
        )}
        {!pendingToken && (editing ? (
          <Card>
            <Cond size={12} color={c.muted}>Adresse du serveur</Cond>
            <TextInput style={input} placeholder="http://192.168.1.20:3000" placeholderTextColor="#9a9ab0" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={draft} onChangeText={setDraft} />
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Btn label="Enregistrer" onPress={saveServer} disabled={busy} color={c.yel} /></View>
              <View style={{ flex: 1 }}><Btn label="Annuler" onPress={() => { setEditing(false); setErr(""); }} /></View>
            </View>
          </Card>
        ) : (
          <Pressable onPress={() => { setDraft(server); setEditing(true); }} disabled={busy} accessibilityLabel="Changer le serveur">
            <Cond size={11} color={c.onSky}>Serveur : {server} (changer)</Cond>
          </Pressable>
        ))}
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
  const [fontsLoaded] = useFonts({ RozhaOne_400Regular, AlfaSlabOne_400Regular, Anton_400Regular, KaushanScript_400Regular });
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [tab, setTab] = useState<Tab>("cap");
  const [missionId, setMissionId] = useState<string | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const toast = useToast();
  useLandingAlert(authed && notificationsReady, toast.show);

  useEffect(() => {
    Promise.all([loadThemeMode(), loadApiUrl().then(() => loadToken())]).then(async ([m, saved]) => {
      applyTheme(m);
      setMode(m);
      if (!saved) return;
      try {
        await verifySession();
        setAuthed(true);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setSessionExpired(true);
          await clearSession();
        } else {
          setAuthed(true);
        }
      }
    }).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready || !fontsLoaded) return;
    let active = true;
    void requestDriverNotifications().finally(() => {
      if (active) setNotificationsReady(true);
    });
    return () => { active = false; };
  }, [ready, fontsLoaded]);
  // Les couleurs sont lues à chaque rendu : on change la palette puis on remonte l'arbre (clé = thème) pour tout repeindre.
  const dark = mode === "dark";
  function toggleTheme() {
    const next: ThemeMode = dark ? "light" : "dark";
    applyTheme(next); setMode(next); void saveThemeMode(next);
  }

  useEffect(() => {
    if (!authed) return;
    let active = true;
    let checking = false;
    async function check() {
      if (!active || checking) return;
      checking = true;
      try {
        await verifySession();
      } catch (error) {
        if (active && error instanceof ApiError && error.status === 401) {
          await clearSession().catch(() => {});
          if (!active) return;
          setMissionId(null);
          setShowMessages(false);
          setSessionExpired(true);
          setAuthed(false);
        }
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = setInterval(check, 30000);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [authed]);

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
  if (!authed) return <Login key={mode} onDone={() => { setSessionExpired(false); setAuthed(true); }} sessionExpired={sessionExpired} dark={dark} onToggleTheme={toggleTheme} />;
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
        {tab === "cap" && <Cap dark={dark} onToggleTheme={toggleTheme} goRadar={() => setTab("radar")} onQuit={async () => { try{await logout();}catch{toast.show("Déconnexion locale ; révocation serveur non confirmée.");}finally{setAuthed(false);setMissionId(null);setShowMessages(false);} }} notify={toast.show} openMission={setMissionId} openMessages={() => setShowMessages(true)} />}
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
