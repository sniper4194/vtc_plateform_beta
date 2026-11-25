import type { ReactNode } from "react";
import { DeadlinesCard, DeadlinesScreen } from "./deadlines";
import { Avatar, IdentityScreen } from "./identity";
import { IncidentCard, IncidentScreen } from "./incident";
import { CostNote, RescueCard, RescuePicker } from "./rescue";
import { SwapBoard, SwapControl } from "./swap";
import { LostItemsCard } from "./lostItems";
import { ReferralCard } from "./referral";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, SectionList, Text, View } from "react-native";
import { api, ApiError } from "./api";
import { countdown, eurShort, needLabels, flightLabel, fuseFraction, groupByDay, isCancelled, NEXT_ACTION, STATUS_LABEL, stepIndex, STEPS, timeOf } from "./format";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, Display, Fuse, HoldButton, Script, Slab, Sticker, ThemeToggle } from "./ui";
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

function Header({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }}>
      <Display size={46} shadow={c.red}>{title}</Display>
      {right}
    </View>
  );
}

/* ------------------------------ CAP (accueil) ------------------------------ */
export function Cap({ goRadar, onQuit, notify, openMission, openMessages, dark, onToggleTheme }: { goRadar: () => void; onQuit: () => void; notify: Notify; openMission: (id: string) => void; openMessages: () => void; dark: boolean; onToggleTheme: () => void }) {
  const me = useFetch<any>("/driver/me", 15000);
  const home = useFetch<any>("/driver/home");
  const [busy, setBusy] = useState(false);
  const [showId, setShowId] = useState(false);
  const [showDl, setShowDl] = useState(false);
  const [showInc, setShowInc] = useState(false);
  const deadlines = useFetch<any[]>("/driver/deadlines", 60000);
  const identity = useFetch<any>("/driver/identity", 20000);
  const online = me.data?.availability === "AVAILABLE";
  const active = me.data?.status === "ACTIVE";
  async function toggle() {
    if (!active) return notify("Votre compte n'est pas encore validé");
    setBusy(true);
    try { await api("/driver/availability", { availability: online ? "SUSPENDED" : "AVAILABLE" }); await me.reload(); notify(online ? "Vous êtes hors ligne" : "Vous êtes en ligne", "ok"); }
    catch (e: any) { notify(e.message); if (e.code === "IDENTITY_CHECK_REQUIRED") setShowId(true); if (e.code === "DOCUMENTS_EXPIRED") setShowDl(true); } finally { setBusy(false); }
  }
  if (me.loading) return <ActivityIndicator color={c.onSky} style={{ marginTop: 80 }} />;
  const v = me.data?.vehicles?.[0];
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 22 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { me.reload(); home.reload(); }} tintColor={c.onSky} />}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Script size={34}>Salut {me.data?.firstName},</Script>
          <Display size={40} shadow={c.red}>cap sur la journée</Display>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          <Pressable onPress={openMessages} accessibilityLabel={`Messages${home.data?.unreadNotifications ? `, ${home.data.unreadNotifications} non lus` : ""}`}>
            <Sticker size={56} color={home.data?.unreadNotifications ? c.red : c.cream} rot={8}>
              <Slab size={22} color={home.data?.unreadNotifications ? c.cream : c.ink} shadow={null}>{home.data?.unreadNotifications ? home.data.unreadNotifications : "✉"}</Slab>
            </Sticker>
          </Pressable>
        </View>
      </View>

      {home.data?.fatigue?.maxMinutes > 0 && home.data.fatigue.minutes24h >= home.data.fatigue.maxMinutes * 0.8 && (
        <Card color={home.data.fatigue.minutes24h >= home.data.fatigue.maxMinutes ? c.red : c.yel}>
          <Slab size={16} color={home.data.fatigue.minutes24h >= home.data.fatigue.maxMinutes ? c.cream : c.ink} shadow={null}>
            {home.data.fatigue.minutes24h >= home.data.fatigue.maxMinutes ? "Temps de repos" : "Pensez au repos"}
          </Slab>
          <Cond size={12} color={home.data.fatigue.minutes24h >= home.data.fatigue.maxMinutes ? c.cream : c.ink}>
            {`${Math.floor(home.data.fatigue.minutes24h / 60)} h ${String(home.data.fatigue.minutes24h % 60).padStart(2, "0")} de mission sur 24 h (maximum ${home.data.fatigue.maxMinutes / 60} h). Au-delà, plus aucune mission ne vous est proposée.`}
          </Cond>
        </Card>
      )}

      {home.data?.liveRideId && (
        <Card color={c.red} onPress={() => openMission(home.data.liveRideId)}>
          <Slab size={17} color={c.cream} shadow={null}>Mission en cours</Slab>
          <Cond size={13} color={c.cream}>Toucher pour la reprendre →</Cond>
        </Card>
      )}

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

      <Card color={identity.data && (identity.data.missing.length > 0 || identity.data.selfie?.mustVerify) ? c.yel : c.cream} onPress={() => setShowId(true)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar photo={identity.data?.photo} size={52} />
        <View style={{ flex: 1 }}>
        <Slab size={17} color={c.ink} shadow={null}>Mon identité</Slab>
        <Cond size={12} color={c.muted}>
          {!identity.data ? "…" : identity.data.selfie?.mustVerify ? "Selfie de prise de service à faire" : identity.data.missing.length > 0 ? `À compléter : ${identity.data.missing.join(", ")}` : "À jour"} →
        </Cond>
        </View>
        </View>
      </Card>
      <IncidentCard onOpen={() => setShowInc(true)} />
      {showInc && <IncidentScreen notify={notify} onClose={() => setShowInc(false)} />}
      <DeadlinesCard list={deadlines.data} onOpen={() => setShowDl(true)} />
      {showDl && <DeadlinesScreen onClose={() => setShowDl(false)} />}
      {showId && <IdentityScreen notify={notify} onClose={() => setShowId(false)} onChanged={() => { identity.reload(); me.reload(); }} />}

      <LostItemsCard notify={notify} />
      <RescueCard notify={notify} onAccepted={openMission} />
      <ReferralCard notify={notify} />

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

/* ------------------------------ LISTE : briques communes ------------------------------ */
const catColor = (cat: string) => ({ BERLINE: c.yel, BUSINESS: c.onSky, VAN: c.red, GREEN: "#3ddc84" } as Record<string, string>)[cat] ?? c.yel;

/** Une ligne de liste : heure + distance | barre de catégorie | trajet + prix. Se déplie en carte. */
function Row({ time, dist, category, from, to, price, rising, flight, badge, expanded, onPress, children }: {
  time: string; dist?: number | null; category: string; from: string; to: string; price: string; rising?: boolean; flight?: boolean;
  badge?: ReactNode; expanded: boolean; onPress?: () => void; children?: ReactNode;
}) {
  const ink = expanded ? c.ink : c.onSky;
  const body = (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 76 }}>
        <Display size={26} color={ink} shadow={expanded ? c.yel : c.red}>{time}</Display>
        {dist != null && <Cond size={12} color={expanded ? c.muted : c.dblue}>à {dist} km</Cond>}
      </View>
      <View style={{ width: 8, borderRadius: 4, backgroundColor: catColor(category), borderWidth: 2, borderColor: c.ink }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Slab size={14} color={ink} shadow={null} lines={expanded ? undefined : 2}>{from}</Slab>
        <Cond size={11} color={expanded ? c.red : c.dblue}>vers</Cond>
        <Slab size={14} color={ink} shadow={null} lines={expanded ? undefined : 2}>{to}</Slab>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
            <Display size={24} color={expanded ? c.ink : c.onSky} shadow={expanded ? c.yel : c.yel}>{price}</Display>
            {rising ? <Slab size={18} color={expanded ? c.red : c.dblue} shadow={null} style={{ lineHeight: 26 }}>↗</Slab> : null}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {badge}
            <Cond size={12} color={expanded ? c.muted : c.onSky}>{category}</Cond>
            {flight ? <Slab size={18} color={ink} shadow={null}>✈︎</Slab> : null}
          </View>
        </View>
      </View>
    </View>
  );
  if (expanded) {
    return (
      <View style={{ marginVertical: 10 }}>
        <Card>
          <Pressable onPress={onPress}>{body}</Pressable>
          <View style={{ marginTop: 14 }}>{children}</View>
        </Card>
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View style={{ paddingVertical: 16, borderBottomWidth: 2, borderStyle: "dashed", borderColor: "rgba(11,42,74,.35)" }}>{body}</View>
    </Pressable>
  );
}

function DayHeader({ title, count, unit }: { title: string; count: number; unit: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 18, paddingBottom: 8, borderBottomWidth: 3, borderColor: c.onSky }}>
      <Cond size={15} color={c.onSky}>{title}</Cond>
      <Cond size={14} color={c.dblue}>{count} {unit}{count > 1 ? "s" : ""}</Cond>
    </View>
  );
}

function FilterChips<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 20, paddingVertical: 12, alignItems: "center" }} style={{ flexGrow: 0, flexShrink: 0 }}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, borderWidth: 2.5, borderColor: c.ink, backgroundColor: value === o.key ? c.yel : c.cream }}>
            <Slab size={13} color={c.ink} shadow={null}>{o.label}</Slab>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/* ------------------------------ RADAR (offres en liste) ------------------------------ */
export function Radar({ notify }: { notify: Notify }) {
  const offers = useFetch<any[]>("/driver/offers", 4000);
  const [, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const seen = useRef<Record<string, { at: number; total: number }>>({});
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  // La barre-mèche part de 100 % à l'arrivée de l'offre.
  for (const o of offers.data ?? []) if (!seen.current[o.offerId]) seen.current[o.offerId] = { at: Date.now(), total: o.secondsLeft };
  const leftOf = (o: any) => Math.max(0, o.secondsLeft - Math.floor((Date.now() - (seen.current[o.offerId]?.at ?? Date.now())) / 1000));

  async function act(id: string, what: "accept" | "decline") {
    try { await api(`/driver/offers/${id}/${what}`, {}); if (what === "accept") notify("Mission à vous ! Direction l'Agenda", "ok"); setOpen(null); }
    catch (e: any) { notify(e instanceof ApiError ? e.message : "Réseau indisponible"); }
    offers.reload();
  }

  const all = offers.data ?? [];
  const cats = Array.from(new Set(all.map((o) => o.category as string)));
  const options = [{ key: "all", label: "Tout" }, ...(all.some((o) => o.flightNumber) ? [{ key: "flight", label: "Avec vol" }] : []), ...cats.map((k) => ({ key: k, label: k }))];
  const shown = all.filter((o) => filter === "all" || (filter === "flight" ? Boolean(o.flightNumber) : o.category === filter));
  const sections = groupByDay(shown, (o) => o.pickupAt);

  return (
    <View style={{ flex: 1 }}>
      <Header title="Radar" right={<Sticker size={54} color={c.yel} rot={8}><Display size={24} color={c.ink} shadow={null}>{all.length}</Display></Sticker>} />
      <FilterChips options={options} value={options.some((o) => o.key === filter) ? filter : "all"} onChange={setFilter} />
      <SectionList
        sections={sections}
        keyExtractor={(o) => o.offerId}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={offers.reload} tintColor={c.cream} />}
        ListHeaderComponent={<SwapBoard notify={notify} />}
        renderSectionHeader={({ section }) => <DayHeader title={section.title} count={section.data.length} unit="mission" />}
        ListEmptyComponent={
          <View style={{ alignItems: "center", marginTop: 50, gap: 12 }}>
            <Sticker size={150} color={c.cream} rot={-5}><Script size={30} color={c.blue}>Calme plat</Script><Cond size={12}>Rien à l'horizon</Cond></Sticker>
            <Cond size={13} color={c.onSky}>{offers.error || "Les nouvelles missions apparaissent ici."}</Cond>
          </View>
        }
        renderItem={({ item: o }) => {
          const left = leftOf(o), total = seen.current[o.offerId]?.total ?? o.secondsLeft;
          const expanded = open === o.offerId;
          return (
            <Row
              time={timeOf(o.pickupAt)} dist={o.pickupDistanceKm} category={o.category}
              from={o.pickup} to={o.dropoff} price={eurShort(o.netCents)} rising={o.priceRising} flight={Boolean(o.flightNumber)}
              badge={!expanded ? <Chip label={countdown(left)} color={left < 60 ? c.red : c.cream} text={left < 60 ? c.cream : c.ink} /> : null}
              expanded={expanded} onPress={() => setOpen(expanded ? null : o.offerId)}
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                <Chip label={`≈ ${eurShort(o.netPerHourCents)}/h`} color={c.yel} />
                {needLabels(o.needs).map((l) => <Chip key={l} label={`⚠ ${l}`} color={c.red} text={c.cream} />)}
                {o.returnTrip ? <Chip label={`↩ Retour après R-${o.returnTrip.afterRef} · ${o.returnTrip.gapMin} min · ${o.returnTrip.km} km`} color={c.yel} /> : null}
                {o.priceRising ? <Chip label="Prix en hausse ↗" color={c.cream} /> : null}
                {o.ecoBonusCents > 0 ? <Chip label={`⚡ dont ${eurShort(o.ecoBonusCents)} prime électrique`} color="#3ddc84" /> : null}
                <Chip label={`${o.durationMin} min · ${o.distanceKm} km`} />
                {o.partner ? <Chip label={o.partner} color={c.blue} text={c.cream} /> : null}
                {o.flightNumber ? <Chip label={`Vol ${o.flightNumber}`} color={c.red} text={c.cream} /> : null}
              </View>
              {o.priceRising ? <Cond size={12} color={c.muted} style={{ marginBottom: 8 }}>Le prix augmente à l'approche de la mission. Il est fixé au moment où vous acceptez.</Cond> : null}
              <Fuse fraction={fuseFraction(left, total)} label={left > 0 ? `Sursis ${countdown(left)} · ensuite la mission part ailleurs` : "Sursis écoulé"} />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12, alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}><Btn label="Passer" onPress={() => act(o.offerId, "decline")} /></View>
                <View style={{ flex: 2 }}><HoldButton label="Je prends" hint="Maintenir pour valider" onComplete={() => act(o.offerId, "accept")} disabled={left <= 0} /></View>
              </View>
            </Row>
          );
        }}
      />
    </View>
  );
}

/* ------------------------------ AGENDA (missions en liste) ------------------------------ */
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

function MissionDetail({ r, run, notify, openMission, reload }: { r: any; run: (id: string, action: string) => void; notify: Notify; openMission: (id: string) => void; reload: () => void }) {
  const next = NEXT_ACTION(r.status);
  const [problem, setProblem] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [rescue, setRescue] = useState(false);
  const [incident, setIncident] = useState(false);
  const target = r.status === "IN_PROGRESS" ? r.dropoff : r.pickup;
  return (
    <View style={{ gap: 10 }}>
      <Btn label="Ouvrir le mode mission" color={c.blue} text={c.cream} onPress={() => openMission(r.rideId)} />
      <View style={{ backgroundColor: c.cream, borderWidth: 2, borderColor: c.ink, borderRadius: 12, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Cond size={11} color={c.muted}>Passager</Cond>
          <Slab size={16} color={c.ink} shadow={null}>{r.passenger.name}</Slab>
          <Cond size={12} color={c.muted}>{r.passengers} pers. · {r.luggage} bagage(s){r.flightNumber ? ` · vol ${r.flightNumber}` : ""}</Cond>
          {r.flight && (() => { const fl = flightLabel(r.flight); return <View style={{ alignSelf: "flex-start", marginTop: 4 }}><Chip label={`✈︎ ${r.flight.number} · ${fl.text}`} color={fl.tone === "bad" ? c.red : fl.tone === "warn" ? c.yel : c.cream} text={fl.tone === "bad" ? c.cream : c.ink} /></View>; })()}
        </View>
        <Btn label="Appeler" onPress={() => Linking.openURL(`tel:${r.passenger.phone}`)} color={c.yel} />
      </View>
      <Stepper status={r.status} />
      <Btn label="Guidage GPS" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`)} />
      {next && <HoldButton label={next.hold} onComplete={() => run(r.rideId, next.action)} />}
      <Pressable onPress={() => { setProblem(!problem); setConfirm(false); }}><Cond size={13} color={c.blue} style={{ textAlign: "center", textDecorationLine: "underline" }}>Un souci ?</Cond></Pressable>
      {problem && r.status === "ARRIVED" && <Btn label="Client introuvable (no-show)" color={c.red} text={c.cream} onPress={() => run(r.rideId, "no-show")} />}
      {(problem || r.swapOfferedAt) && <SwapControl r={r} notify={notify} reload={reload} />}
      {problem && (r.status === "ASSIGNED" || r.status === "EN_ROUTE") && <CostNote rideId={r.rideId} />}
      {problem && (r.status === "ASSIGNED" || r.status === "EN_ROUTE") && <Btn label="Appeler un sauveteur" color={c.yel} onPress={() => setRescue(true)} />}
      {rescue && <RescuePicker rideId={r.rideId} notify={notify} onClose={() => setRescue(false)} />}
      {incident && <IncidentScreen rideId={r.rideId} notify={notify} onClose={() => setIncident(false)} />}
      {problem && <Btn label="Signaler un incident" color={c.red} text={c.cream} onPress={() => setIncident(true)} />}
      {problem && (r.status === "ASSIGNED" || r.status === "EN_ROUTE") && (
        <Btn
          label={confirm ? "Confirmer : je rends la mission" : "Je ne peux plus la faire"}
          color={c.red} text={c.cream}
          onPress={() => { if (confirm) run(r.rideId, "cancel"); else { setConfirm(true); notify("Une pénalité s'applique (voir le montant ci-dessus). Touchez à nouveau pour confirmer."); } }}
        />
      )}
    </View>
  );
}

export function Agenda({ notify, openMission }: { notify: Notify; openMission: (id: string) => void }) {
  const [scope, setScope] = useState<"upcoming" | "history">("upcoming");
  const rides = useFetch<any[]>(`/driver/rides?scope=${scope}`, 5000);
  const [open, setOpen] = useState<string | null>(null);
  const upcoming = scope === "upcoming";
  // Une mission déjà commencée s'ouvre toute seule.
  const live = upcoming ? rides.data?.find((r) => r.status !== "ASSIGNED")?.rideId ?? null : null;
  const openId = open ?? live;
  async function run(rideId: string, action: string) {
    try { await api(`/driver/rides/${rideId}/${action}`, {}); } catch (e: any) { notify(e.message); }
    rides.reload();
  }
  const sections = groupByDay(rides.data ?? [], (r) => r.pickupAt);
  return (
    <View style={{ flex: 1 }}>
      <Header title="Agenda" />
      <FilterChips options={[{ key: "upcoming", label: "À venir" }, { key: "history", label: "Archives" }]} value={scope} onChange={(k) => { setScope(k); setOpen(null); }} />
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.rideId}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={rides.reload} tintColor={c.cream} />}
        renderSectionHeader={({ section }) => <DayHeader title={section.title} count={section.data.length} unit="mission" />}
        ListEmptyComponent={<View style={{ alignItems: "center", marginTop: 40 }}><Script size={30}>{rides.error || (upcoming ? "Aucune mission au programme" : "Rien dans les archives")}</Script></View>}
        renderItem={({ item: r }) => {
          const expanded = upcoming && openId === r.rideId;
          return (
            <Row
              time={timeOf(r.pickupAt)} category={r.category} from={r.pickup.address} to={r.dropoff.address}
              price={isCancelled(r.status) ? (r.compensationCents ? `+${eurShort(r.compensationCents)}` : "—") : eurShort(r.netCents)} flight={Boolean(r.flight)}
              badge={<Chip label={upcoming ? (STEPS[stepIndex(r.status)]?.short ?? r.status) : (STATUS_LABEL[r.status] ?? r.status)} color={upcoming ? c.yel : isCancelled(r.status) ? c.red : c.cream} text={!upcoming && isCancelled(r.status) ? c.cream : c.ink} />}
              expanded={expanded} onPress={upcoming ? () => setOpen(expanded ? "" : r.rideId) : undefined}
            >
              <MissionDetail r={r} run={run} notify={notify} openMission={openMission} reload={rides.reload} />
            </Row>
          );
        }}
      />
    </View>
  );
}

/* ------------------------------ MESSAGES ------------------------------ */
export function Messages({ onClose, notify, openMission }: { onClose: () => void; notify: Notify; openMission: (id: string) => void }) {
  const box = useFetch<{ unread: number; items: any[] }>("/driver/notifications", 8000);
  async function read(ids?: string[]) {
    try { await api("/driver/notifications/read", ids ? { ids } : {}); } catch (e: any) { notify(e.message); }
    box.reload();
  }
  const items = box.data?.items ?? [];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 18, gap: 14 }}>
        <Pressable onPress={onClose} accessibilityLabel="Retour"><Sticker size={46} color={c.cream}><Slab size={20} color={c.ink} shadow={null}>←</Slab></Sticker></Pressable>
        <Display size={40} shadow={c.red}>Messages</Display>
      </View>
      <View style={{ paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Cond size={13} color={c.onSky}>{box.data?.unread ? `${box.data.unread} non lu(s)` : "Tout est lu"}</Cond>
        {box.data?.unread ? <Btn label="Tout marquer comme lu" onPress={() => read()} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 18 }} refreshControl={<RefreshControl refreshing={false} onRefresh={box.reload} tintColor={c.onSky} />}>
        {items.map((m) => (
          <Card key={m.id} color={m.readAt ? c.cream : c.yel} onPress={() => !m.readAt && read([m.id])}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}><Slab size={16} color={c.ink} shadow={null}>{m.title}</Slab></View>
              {!m.readAt && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.red, borderWidth: 2, borderColor: c.ink, marginTop: 4 }} />}
            </View>
            <Cond size={11} color={c.muted}>{new Date(m.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Cond>
            <Text style={{ color: c.ink, marginTop: 6, lineHeight: 20 }}>{m.body}</Text>
            {m.data?.rideId ? <View style={{ marginTop: 10, alignItems: "flex-start" }}><Btn label="Voir la mission" onPress={() => { read([m.id]); onClose(); openMission(m.data.rideId); }} /></View> : null}
            
          </Card>
        ))}
        {!items.length && <View style={{ alignItems: "center", marginTop: 40 }}><Script size={30}>{box.error || "Aucun message"}</Script></View>}
      </ScrollView>
    </View>
  );
}
