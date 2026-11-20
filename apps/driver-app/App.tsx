import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { api, ApiError, loadToken, saveToken } from "./src/api";
import { countdown, eur, NEXT_ACTION, whenLabel } from "./src/format";
import { c } from "./src/theme";

type Tab = "home" | "offers" | "rides";

function Btn({ label, onPress, kind = "primary", disabled }: { label: string; onPress: () => void; kind?: "primary" | "ok" | "bad" | "ghost"; disabled?: boolean }) {
  const bg = { primary: c.blue, ok: c.ok, bad: c.bad, ghost: c.card }[kind];
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, kind === "ghost" && { borderWidth: 1, borderColor: c.line }]}>
      <Text style={[s.btnText, kind === "ghost" && { color: c.ink }]}>{label}</Text>
    </Pressable>
  );
}

function useFetch<T>(path: string, everyMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await api<T>(path)); setError(""); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => {
    load();
    const t = setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, error, loading, reload: load };
}

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/driver/login", { phone: phone.trim(), code: code.trim() });
      await saveToken(r.token);
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <SafeAreaView style={s.screen}>
      <View style={{ padding: 24, gap: 12, marginTop: 60 }}>
        <Text style={[s.h1, { color: c.brand }]}>VTC Chauffeur</Text>
        <TextInput style={s.input} placeholder="Téléphone (+33…)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoCapitalize="none" />
        <TextInput style={s.input} placeholder="Code" keyboardType="number-pad" value={code} onChangeText={setCode} />
        {err ? <Text style={{ color: c.bad }}>{err}</Text> : null}
        <Btn label={busy ? "Connexion…" : "Se connecter"} onPress={submit} disabled={busy || !phone || !code} />
      </View>
    </SafeAreaView>
  );
}

function Home({ goOffers }: { goOffers: () => void }) {
  const me = useFetch<any>("/driver/me", 15000);
  const home = useFetch<any>("/driver/home");
  const [busy, setBusy] = useState(false);
  const available = me.data?.availability === "AVAILABLE";
  async function toggle() {
    setBusy(true);
    try { await api("/driver/availability", { availability: available ? "SUSPENDED" : "AVAILABLE" }); await me.reload(); }
    catch (e: any) { Alert.alert("Impossible", e.message); } finally { setBusy(false); }
  }
  if (me.loading) return <ActivityIndicator style={{ marginTop: 60 }} />;
  const active = me.data?.status === "ACTIVE";
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { me.reload(); home.reload(); }} />}>
      <Text style={s.h1}>Bienvenue {me.data?.firstName} !</Text>
      {!active && (
        <View style={[s.card, { backgroundColor: c.soft }]}>
          <Text style={s.bold}>Compte {me.data?.status === "SUSPENDED" ? "suspendu" : "en cours de validation"}</Text>
          <Text style={{ color: c.muted }}>Vous pourrez prendre des courses dès que vos documents seront validés.</Text>
        </View>
      )}
      <View style={s.grid}>
        <View style={[s.card, s.tile]}><Text style={s.label}>Courses à prendre</Text><Text style={s.big}>{home.data ? eur(home.data.potentialCents) : "—"}</Text><Text style={s.muted}>{home.data?.pendingOffers ?? 0} offre(s) autour de vous</Text><Btn label="Voir" onPress={goOffers} /></View>
        <View style={[s.card, s.tile]}><Text style={s.label}>Courses à venir</Text><Text style={s.big}>{home.data?.upcomingRides ?? "—"}</Text><Text style={s.muted}>dans votre planning</Text></View>
        <View style={[s.card, s.tile]}><Text style={s.label}>Chiffre d'affaires</Text><Text style={s.big}>{home.data ? eur(home.data.fortnightEarningsCents) : "—"}</Text><Text style={s.muted}>net, quinzaine en cours</Text></View>
        <View style={[s.card, s.tile]}><Text style={s.label}>Mon véhicule</Text><Text style={s.bold}>{me.data?.vehicles?.[0] ? `${me.data.vehicles[0].make} ${me.data.vehicles[0].model}` : "—"}</Text><Text style={s.muted}>{me.data?.vehicles?.[0]?.plate ?? ""}</Text></View>
      </View>
      <View style={[s.card, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <Text style={s.bold}>Statut : <Text style={{ color: available ? c.ok : c.muted }}>{available ? "Disponible" : "Suspendu"}</Text></Text>
        <View style={{ width: 150 }}><Btn label={available ? "SUSPENDRE" : "ME RENDRE DISPO"} onPress={toggle} disabled={busy || !active} kind={available ? "ghost" : "ok"} /></View>
      </View>
    </ScrollView>
  );
}

function Offers() {
  const offers = useFetch<any[]>("/driver/offers", 4000);
  const [tick, setTick] = useState(0);
  const fetchedAt = useRef(Date.now());
  useEffect(() => { fetchedAt.current = Date.now(); setTick(0); }, [offers.data]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  async function act(id: string, what: "accept" | "decline") {
    try {
      await api(`/driver/offers/${id}/${what}`, {});
      if (what === "accept") Alert.alert("Course acceptée", "Retrouvez-la dans « Mes courses ».");
    } catch (e: any) { Alert.alert(what === "accept" ? "Course non attribuée" : "Erreur", e instanceof ApiError ? e.message : "Réseau indisponible"); }
    offers.reload();
  }
  return (
    <FlatList
      data={offers.data ?? []}
      keyExtractor={(o) => o.offerId}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={offers.reload} />}
      ListEmptyComponent={<Text style={[s.muted, { textAlign: "center", marginTop: 40 }]}>{offers.error || "Aucune course à prendre pour le moment."}</Text>}
      renderItem={({ item: o }) => {
        const left = o.secondsLeft - Math.floor((Date.now() - fetchedAt.current) / 1000);
        return (
          <View style={s.card}>
            <Text style={[s.when]}>{whenLabel(o.pickupAt)}</Text>
            <Text style={s.price}>{eur(o.netCents)} <Text style={s.muted}>NET</Text></Text>
            <View style={s.chips}><Text style={[s.chip, { color: c.ok }]}>≈ {eur(o.netPerHourCents)}/h</Text><Text style={s.chip}>{o.category}</Text>{o.partner ? <Text style={s.chip}>{o.partner}</Text> : null}</View>
            <View style={s.route}>
              <Text style={s.addr}>{o.pickup}</Text>
              <Text style={s.muted}>Durée : {o.durationMin} min · {o.distanceKm} km</Text>
              <Text style={s.addr}>{o.dropoff}</Text>
              {o.flightNumber ? <Text style={s.muted}>Vol {o.flightNumber}</Text> : null}
            </View>
            <Text style={{ textAlign: "center", marginVertical: 8 }}><Text style={s.bold}>{countdown(left)}</Text> avant que cette course ne soit redistribuée</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Btn label="Refuser" kind="bad" onPress={() => act(o.offerId, "decline")} /></View>
              <View style={{ flex: 1 }}><Btn label="Accepter" kind="ok" onPress={() => act(o.offerId, "accept")} disabled={left <= 0} /></View>
            </View>
          </View>
        );
      }}
    />
  );
}

function Rides() {
  const [scope, setScope] = useState<"upcoming" | "history">("upcoming");
  const rides = useFetch<any[]>(`/driver/rides?scope=${scope}`, 5000);
  async function run(rideId: string, action: string) {
    try { await api(`/driver/rides/${rideId}/${action}`, {}); } catch (e: any) { Alert.alert("Impossible", e.message); }
    rides.reload();
  }
  function cancel(rideId: string) {
    Alert.alert("Annuler la course ?", "La course sera proposée à d'autres chauffeurs et cela affecte votre score de fiabilité.", [
      { text: "Retour", style: "cancel" }, { text: "Annuler la course", style: "destructive", onPress: () => run(rideId, "cancel") },
    ]);
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", padding: 12, gap: 8 }}>
        {(["upcoming", "history"] as const).map((k) => (
          <Pressable key={k} onPress={() => setScope(k)} style={[s.seg, scope === k && { backgroundColor: c.blue }]}>
            <Text style={{ color: scope === k ? "#fff" : c.ink }}>{k === "upcoming" ? "À venir" : "Historique"}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rides.data ?? []}
        keyExtractor={(r) => r.rideId}
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={rides.reload} />}
        ListEmptyComponent={<Text style={[s.muted, { textAlign: "center", marginTop: 40 }]}>{rides.error || "Aucune course."}</Text>}
        renderItem={({ item: r }) => {
          const next = NEXT_ACTION[r.status];
          const target = r.status === "IN_PROGRESS" ? r.dropoff : r.pickup;
          return (
            <View style={s.card}>
              <Text style={s.when}>{whenLabel(r.pickupAt)}</Text>
              <Text style={s.price}>{eur(r.netCents)} <Text style={s.muted}>NET · {r.status}</Text></Text>
              <View style={s.route}><Text style={s.addr}>{r.pickup.address}</Text><Text style={s.addr}>→ {r.dropoff.address}</Text></View>
              <Text style={s.bold}>{r.passenger.name} · {r.passengers} pax · {r.luggage} bag.</Text>
              {r.flightNumber ? <Text style={s.muted}>Vol {r.flightNumber}</Text> : null}
              {scope === "upcoming" && (
                <View style={{ gap: 8, marginTop: 10 }}>
                  <Btn label="Appeler le client" kind="ghost" onPress={() => Linking.openURL(`tel:${r.passenger.phone}`)} />
                  <Btn label="Naviguer" kind="ghost" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`)} />
                  {next && <Btn label={next.label} onPress={() => run(r.rideId, next.action)} />}
                  {r.status === "ARRIVED" && <Btn label="Client absent (no-show)" kind="bad" onPress={() => run(r.rideId, "no-show")} />}
                  {(r.status === "ASSIGNED" || r.status === "EN_ROUTE") && <Btn label="Annuler la course" kind="bad" onPress={() => cancel(r.rideId)} />}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("home");

  useEffect(() => { loadToken().then((t) => { setAuthed(Boolean(t)); setReady(true); }); }, []);

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

  if (!ready) return <ActivityIndicator style={{ marginTop: 80 }} />;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const tabs: [Tab, string][] = [["home", "Accueil"], ["offers", "Courses à prendre"], ["rides", "Mes courses"]];
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === "home" && <Home goOffers={() => setTab("offers")} />}
        {tab === "offers" && <Offers />}
        {tab === "rides" && <Rides />}
      </View>
      <View style={s.tabbar}>
        {tabs.map(([k, l]) => (
          <Pressable key={k} style={s.tab} onPress={() => setTab(k)}><Text style={{ color: tab === k ? c.brand : c.muted, fontWeight: tab === k ? "700" : "400" }}>{l}</Text></Pressable>
        ))}
        <Pressable style={s.tab} onPress={async () => { await saveToken(null); setAuthed(false); }}><Text style={{ color: c.muted }}>Quitter</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  h1: { fontSize: 26, fontWeight: "700", color: c.ink },
  card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 16, gap: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "47.5%", gap: 6 },
  label: { color: c.blue, fontWeight: "600" },
  big: { fontSize: 24, fontWeight: "700", color: c.blue },
  bold: { fontWeight: "700", color: c.ink, fontSize: 15 },
  muted: { color: c.muted, fontSize: 13 },
  when: { color: c.brand, fontSize: 20, fontWeight: "700" },
  price: { fontSize: 30, fontWeight: "700", color: c.ink },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginVertical: 6 },
  chip: { backgroundColor: c.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden", fontWeight: "600" },
  route: { backgroundColor: c.soft, borderRadius: 12, padding: 12, gap: 6, marginVertical: 6 },
  addr: { fontWeight: "700", color: c.ink },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 14, fontSize: 16 },
  seg: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
  tabbar: { flexDirection: "row", borderTopWidth: 2, borderTopColor: c.brand, backgroundColor: c.card },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
});
