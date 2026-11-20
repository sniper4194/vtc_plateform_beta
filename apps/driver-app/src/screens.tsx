import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, ApiError } from "./api";
import { countdown, eur, eurShort, fuseFraction, NEXT_ACTION, stepIndex, STEPS, whenLabel } from "./format";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, Display, Fuse, HoldButton, Script, Slab, Sticker } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;

function Route({ from, to }: { from: string; to: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, marginVertical: 8 }}>
      <View style={{ alignItems: "center", paddingTop: 4 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.red, borderWidth: 2.5, borderColor: c.ink }} />
        <View style={{ flex: 1, width: 0, borderLeftWidth: 3, borderColor: c.ink, borderStyle: "dashed", marginVertical: 2 }} />
        <View style={{ width: 15, height: 15, backgroundColor: c.blue, borderWidth: 2.5, borderColor: c.ink, transform: [{ rotate: "45deg" }] }} />
      </View>
      <View style={{ flex: 1, gap: 14 }}>
        <Text2>{from}</Text2>
        <Text2>{to}</Text2>
      </View>
    </View>
  );
}
const Text2 = ({ children }: { children: string }) => <Slab size={15} color={c.ink} shadow={null} style={{ lineHeight: 20 }}>{children}</Slab>;

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }}>
      <Display size={46} shadow={c.red}>{title}</Display>
      {right}
    </View>
  );
}

/* ------------------------------ CAP (accueil) ------------------------------ */
export function Cap({ goRadar, onQuit, notify }: { goRadar: () => void; onQuit: () => void; notify: Notify }) {
  const me = useFetch<any>("/driver/me", 15000);
  const home = useFetch<any>("/driver/home");
  const [busy, setBusy] = useState(false);
  const online = me.data?.availability === "AVAILABLE";
  const active = me.data?.status === "ACTIVE";
  async function toggle() {
    if (!active) return notify("Votre compte n'est pas encore validé");
    setBusy(true);
    try { await api("/driver/availability", { availability: online ? "SUSPENDED" : "AVAILABLE" }); await me.reload(); notify(online ? "Vous êtes hors ligne" : "Vous êtes en ligne", "ok"); }
    catch (e: any) { notify(e.message); } finally { setBusy(false); }
  }
  if (me.loading) return <ActivityIndicator color={c.cream} style={{ marginTop: 80 }} />;
  const v = me.data?.vehicles?.[0];
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 22 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { me.reload(); home.reload(); }} tintColor={c.cream} />}>
      <View>
        <Script size={34}>Salut {me.data?.firstName},</Script>
        <Display size={40} shadow={c.red}>cap sur la journée</Display>
      </View>

      {!active && (
        <Card color={c.red}>
          <Slab size={16} color={c.cream} shadow={null}>Compte {me.data?.status === "SUSPENDED" ? "suspendu" : "en cours de validation"}</Slab>
          <Cond size={13} color={c.cream}>Vous pourrez rouler dès la validation de vos documents.</Cond>
        </Card>
      )}

      <Card color={c.yel}>
        <Cond size={14}>Gains de la quinzaine · net</Cond>
        <Display size={58} color={c.ink} shadow={c.red}>{home.data ? eurShort(home.data.fortnightEarningsCents) : "—"}</Display>
      </Card>

      <View style={{ flexDirection: "row", justifyContent: "space-around", alignItems: "center" }}>
        <Pressable onPress={goRadar}>
          <Sticker size={150} color={c.red} rot={-7}>
            <Cond size={12} color={c.yel}>À l'horizon</Cond>
            <Display size={32} color={c.cream} shadow={c.dblue}>{home.data ? eurShort(home.data.potentialCents) : "—"}</Display>
            <Cond size={12} color={c.cream}>{home.data?.pendingOffers ?? 0} offre(s)</Cond>
          </Sticker>
        </Pressable>
        <Sticker size={124} color={c.cream} rot={6}>
          <Cond size={12}>Au programme</Cond>
          <Display size={44} color={c.blue} shadow={c.red}>{home.data?.upcomingRides ?? "—"}</Display>
          <Cond size={11}>mission(s)</Cond>
        </Sticker>
      </View>

      <View style={{ alignItems: "center", gap: 8 }}>
        <Pressable onPress={toggle} disabled={busy} accessibilityRole="switch" accessibilityState={{ checked: online }}>
          <Sticker size={176} color={online ? c.yel : c.cream} rot={-3}>
            <Cond size={13}>Statut</Cond>
            <Display size={34} color={online ? c.ink : c.muted} shadow={online ? c.red : null}>{online ? "EN LIGNE" : "HORS LIGNE"}</Display>
            <Cond size={11} style={{ opacity: 0.7 }}>Toucher pour {online ? "couper" : "rouler"}</Cond>
          </Sticker>
        </Pressable>
        {v ? <Chip label={`${v.make} ${v.model} · ${v.plate}`} /> : null}
      </View>
      <View style={{ alignItems: "center" }}><Btn label="Quitter" onPress={onQuit} /></View>
    </ScrollView>
  );
}

/* ------------------------------ RADAR (offres) ------------------------------ */
function Ticket({ o, left, total, onTake, onPass }: { o: any; left: number; total: number; onTake: () => void; onPass: () => void }) {
  return (
    <Card style={{ paddingVertical: 14 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Script size={26} color={c.red}>{whenLabel(o.pickupAt)}</Script>
          <Route from={o.pickup} to={o.dropoff} />
        </View>
        <Sticker size={96} color={c.yel} rot={-8}>
          <Display size={eurShort(o.netCents).length > 5 ? 21 : 28} color={c.ink} shadow={c.red}>{eurShort(o.netCents)}</Display>
          <Cond size={11}>net</Cond>
        </Sticker>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 6 }}>
        <Chip label={`≈ ${eurShort(o.netPerHourCents)}/h`} color={c.yel} />
        <Chip label={`${o.durationMin} min · ${o.distanceKm} km`} />
        <Chip label={o.category} />
        {o.partner ? <Chip label={o.partner} color={c.blue} text={c.cream} /> : null}
        {o.flightNumber ? <Chip label={`Vol ${o.flightNumber}`} color={c.red} text={c.cream} /> : null}
      </View>
      {/* perforation du billet */}
      <View style={{ height: 24, justifyContent: "center", marginVertical: 4 }}>
        <View style={{ borderTopWidth: 3, borderStyle: "dashed", borderColor: c.ink }} />
        <View style={{ position: "absolute", left: -32, width: 26, height: 26, borderRadius: 13, backgroundColor: c.blue, borderWidth: 2.5, borderColor: c.ink }} />
        <View style={{ position: "absolute", right: -32, width: 26, height: 26, borderRadius: 13, backgroundColor: c.blue, borderWidth: 2.5, borderColor: c.ink }} />
      </View>
      <Fuse fraction={fuseFraction(left, total)} label={left > 0 ? `Sursis ${countdown(left)} · ensuite la mission part ailleurs` : "Sursis écoulé"} />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}><Btn label="Passer" onPress={onPass} /></View>
        <View style={{ flex: 2 }}><HoldButton label="Je prends" hint="Maintenir pour valider" onComplete={onTake} disabled={left <= 0} /></View>
      </View>
    </Card>
  );
}

export function Radar({ notify }: { notify: Notify }) {
  const offers = useFetch<any[]>("/driver/offers", 4000);
  const [, setTick] = useState(0);
  const seen = useRef<Record<string, { at: number; total: number }>>({});
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  // On mémorise la durée de sursis vue à l'arrivée de l'offre (la barre part de 100 %).
  useEffect(() => {
    for (const o of offers.data ?? []) {
      const s = seen.current[o.offerId];
      if (!s) seen.current[o.offerId] = { at: Date.now(), total: o.secondsLeft };
    }
  }, [offers.data]);
  const leftOf = (o: any) => Math.max(0, o.secondsLeft - Math.floor((Date.now() - (seen.current[o.offerId]?.at ?? Date.now())) / 1000));
  async function act(id: string, what: "accept" | "decline") {
    try { await api(`/driver/offers/${id}/${what}`, {}); if (what === "accept") notify("Mission à vous ! Direction l'Agenda", "ok"); }
    catch (e: any) { notify(e instanceof ApiError ? e.message : "Réseau indisponible"); }
    offers.reload();
  }
  return (
    <View style={{ flex: 1 }}>
      <Header title="Radar" right={
        <Sticker size={54} color={c.yel} rot={8}><Display size={24} color={c.ink} shadow={null}>{offers.data?.length ?? 0}</Display></Sticker>
      } />
      <FlatList
        data={offers.data ?? []}
        keyExtractor={(o) => o.offerId}
        contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 22 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={offers.reload} tintColor={c.cream} />}
        ListEmptyComponent={
          <View style={{ alignItems: "center", marginTop: 50, gap: 12 }}>
            <Sticker size={150} color={c.cream} rot={-5}><Script size={30} color={c.blue}>Calme plat</Script><Cond size={12}>Rien à l'horizon</Cond></Sticker>
            <Cond size={13} color={c.cream}>{offers.error || "Les nouvelles missions apparaissent ici."}</Cond>
          </View>
        }
        renderItem={({ item: o }) => {
          const total = seen.current[o.offerId]?.total ?? o.secondsLeft;
          return <Ticket o={o} left={leftOf(o)} total={total} onTake={() => act(o.offerId, "accept")} onPass={() => act(o.offerId, "decline")} />;
        }}
      />
    </View>
  );
}

/* ------------------------------ AGENDA (missions) ------------------------------ */
function Stepper({ status }: { status: string }) {
  const idx = stepIndex(status);
  return (
    <View style={{ flexDirection: "row", marginVertical: 10 }}>
      {STEPS.map((s, i) => {
        const done = i < idx, now = i === idx;
        return (
          <View key={s.status} style={{ flex: 1, alignItems: "center", gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
              <View style={{ flex: 1, height: 4, backgroundColor: i === 0 ? "transparent" : done || now ? c.ink : "#c9c3b2" }} />
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: c.ink, backgroundColor: done ? c.blue : now ? c.yel : c.cream }} />
              <View style={{ flex: 1, height: 4, backgroundColor: i === STEPS.length - 1 ? "transparent" : done ? c.ink : "#c9c3b2" }} />
            </View>
            <Cond size={11} color={now ? c.red : c.muted}>{s.short}</Cond>
          </View>
        );
      })}
    </View>
  );
}

function Mission({ r, upcoming, run, notify }: { r: any; upcoming: boolean; run: (id: string, action: string) => void; notify: Notify }) {
  const next = NEXT_ACTION(r.status);
  const [problem, setProblem] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const target = r.status === "IN_PROGRESS" ? r.dropoff : r.pickup;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Script size={26} color={c.red}>{whenLabel(r.pickupAt)}</Script>
        <Chip label={upcoming ? eurShort(r.netCents) + " net" : r.status} color={upcoming ? c.yel : c.cream} />
      </View>
      <Route from={r.pickup.address} to={r.dropoff.address} />
      <View style={{ backgroundColor: c.cream, borderWidth: 2, borderColor: c.ink, borderRadius: 12, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Cond size={11} color={c.muted}>Passager</Cond>
          <Slab size={16} color={c.ink} shadow={null}>{r.passenger.name}</Slab>
          <Cond size={12} color={c.muted}>{r.passengers} pers. · {r.luggage} bagage(s){r.flightNumber ? ` · vol ${r.flightNumber}` : ""}</Cond>
        </View>
        {upcoming && <Btn label="Appeler" onPress={() => Linking.openURL(`tel:${r.passenger.phone}`)} color={c.yel} />}
      </View>
      {upcoming && (
        <>
          <Stepper status={r.status} />
          <View style={{ gap: 10 }}>
            <Btn label="Guidage GPS" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`)} />
            {next && <HoldButton label={next.hold} onComplete={() => run(r.rideId, next.action)} />}
            <Pressable onPress={() => { setProblem(!problem); setConfirm(false); }}><Cond size={13} color={c.blue} style={{ textAlign: "center", textDecorationLine: "underline" }}>Un souci ?</Cond></Pressable>
            {problem && r.status === "ARRIVED" && <Btn label="Client introuvable (no-show)" color={c.red} text={c.cream} onPress={() => run(r.rideId, "no-show")} />}
            {problem && (r.status === "ASSIGNED" || r.status === "EN_ROUTE") && (
              <Btn
                label={confirm ? "Confirmer : je rends la mission" : "Je ne peux plus la faire"}
                color={c.red} text={c.cream}
                onPress={() => { if (confirm) run(r.rideId, "cancel"); else { setConfirm(true); notify("Cela pèse sur votre score de fiabilité. Touchez à nouveau pour confirmer."); } }}
              />
            )}
          </View>
        </>
      )}
    </Card>
  );
}

export function Agenda({ notify }: { notify: Notify }) {
  const [scope, setScope] = useState<"upcoming" | "history">("upcoming");
  const rides = useFetch<any[]>(`/driver/rides?scope=${scope}`, 5000);
  async function run(rideId: string, action: string) {
    try { await api(`/driver/rides/${rideId}/${action}`, {}); } catch (e: any) { notify(e.message); }
    rides.reload();
  }
  return (
    <View style={{ flex: 1 }}>
      <Header title="Agenda" />
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingVertical: 8 }}>
        {(["upcoming", "history"] as const).map((k) => (
          <Pressable key={k} onPress={() => setScope(k)}>
            <View style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, borderWidth: 2.5, borderColor: c.ink, backgroundColor: scope === k ? c.yel : c.cream }}>
              <Slab size={14} color={c.ink} shadow={null}>{k === "upcoming" ? "À venir" : "Archives"}</Slab>
            </View>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rides.data ?? []}
        keyExtractor={(r) => r.rideId}
        contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 22 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={rides.reload} tintColor={c.cream} />}
        ListEmptyComponent={<View style={{ alignItems: "center", marginTop: 40 }}><Script size={30}>{rides.error || (scope === "upcoming" ? "Aucune mission au programme" : "Rien dans les archives")}</Script></View>}
        renderItem={({ item: r }) => <Mission r={r} upcoming={scope === "upcoming"} run={run} notify={notify} />}
      />
    </View>
  );
}
