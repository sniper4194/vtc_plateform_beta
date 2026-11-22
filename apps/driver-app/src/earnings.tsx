import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Share, View } from "react-native";
import { api, apiText } from "./api";
import { dayLabel, eurShort, hoursLabel, timeOf } from "./format";
import { c } from "./theme";
import { Btn, Card, Chip, Cond, Display, Slab } from "./ui";
import { useFetch } from "./useFetch";

type Notify = (text: string, tone?: "ok" | "bad") => void;
const PERIODS = [{ key: "day", label: "Jour" }, { key: "week", label: "Semaine" }, { key: "fortnight", label: "Quinzaine" }, { key: "month", label: "Mois" }];

function Row({ label, value, tone }: { label: string; value: string; tone?: "bad" | "ok" }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderColor: "#d9e0e7" }}>
      <Cond size={14} color={c.ink}>{label}</Cond>
      <Slab size={16} color={tone === "bad" ? c.red : c.ink} shadow={null}>{value}</Slab>
    </View>
  );
}

/** Onglet Revenus : net de la période, détail, rendement par heure de mission, jours, courses, export. */
export function Earnings({ notify }: { notify: Notify }) {
  const [period, setPeriod] = useState("fortnight");
  const q = useFetch<any>(`/driver/earnings?period=${period}`, 20000);
  const d = q.data;

  async function exportCsv() {
    try {
      const csv = await apiText(`/driver/earnings/csv?period=${period}`);
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a"); a.href = url; a.download = "mes-revenus.csv"; a.click(); URL.revokeObjectURL(url);
      } else await Share.share({ title: "Mes revenus", message: csv });
      notify("Export prêt", "ok");
    } catch (e: any) { notify(e.message); }
  }

  const max = Math.max(1, ...(d?.days ?? []).map((x: any) => Math.abs(x.cents)));
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} tintColor={c.onSky} />}>
      <Display size={38} shadow={c.red}>Revenus</Display>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PERIODS.map((p) => <Pressable key={p.key} onPress={() => setPeriod(p.key)} accessibilityRole="button" accessibilityState={{ selected: period === p.key }}><Chip label={p.label} color={period === p.key ? c.yel : c.cream} /></Pressable>)}
      </View>
      {!d ? <ActivityIndicator color={c.onSky} style={{ marginTop: 40 }} /> : (
        <>
          <Card color={c.yel}>
            <Cond size={13}>Net de la période</Cond>
            <Display size={56} color={c.ink} shadow={c.red}>{eurShort(d.totals.netCents)}</Display>
            <Cond size={12} color={c.muted}>{d.totals.rides} course(s){d.upcomingRides ? ` · à venir : ${eurShort(d.upcomingCents)} (${d.upcomingRides})` : ""}</Cond>
          </Card>

          <Card>
            <Row label="Courses" value={eurShort(d.totals.ridesCents)} />
            <Row label="Indemnités d'annulation" value={`+ ${eurShort(d.totals.compensationCents)}`} />
            <Row label="Pénalités" value={d.totals.penaltyCents ? `− ${eurShort(d.totals.penaltyCents)}` : eurShort(0)} tone={d.totals.penaltyCents ? "bad" : undefined} />
          </Card>

          <Card>
            <Cond size={13} color={c.muted}>Rendement des missions</Cond>
            <Display size={36} color={c.blue} shadow={null}>{d.totals.netPerMissionHourCents != null ? `${eurShort(d.totals.netPerMissionHourCents)} / h` : "—"}</Display>
            <Cond size={12} color={c.muted}>{hoursLabel(d.totals.missionHours)} de mission{d.totals.avgPerRideCents != null ? ` · ${eurShort(d.totals.avgPerRideCents)} par course` : ""}</Cond>
            <Cond size={11} color={c.muted}>Heures de mission : de la mise en route à la fin de la course. Le temps en ligne sans mission n'est pas compté.</Cond>
          </Card>

          {d.days.length > 0 && (
            <Card>
              <Cond size={13} color={c.muted}>Par jour</Cond>
              {d.days.map((x: any) => (
                <View key={x.day} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <View style={{ width: 84 }}><Cond size={12} color={c.ink}>{dayLabel(x.day)}</Cond></View>
                  <View style={{ flex: 1, height: 14, backgroundColor: "#e6ecf2", borderRadius: 7, overflow: "hidden" }}>
                    <View style={{ width: `${Math.max(4, (Math.abs(x.cents) / max) * 100)}%`, height: "100%", backgroundColor: x.cents < 0 ? c.red : c.blue, borderRadius: 7 }} />
                  </View>
                  <View style={{ width: 80, alignItems: "flex-end" }}><Cond size={12} color={c.ink}>{eurShort(x.cents)}</Cond></View>
                </View>
              ))}
            </Card>
          )}

          {d.rides.length > 0 && (
            <Card>
              <Cond size={13} color={c.muted}>Courses</Cond>
              {d.rides.map((r: any) => (
                <View key={r.rideId} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: "#d9e0e7" }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Cond size={12} color={c.muted}>R-{r.ref} · {dayLabel(r.at.slice(0, 10))} {timeOf(r.at)}</Cond>
                    <Slab size={16} color={c.ink} shadow={null}>{eurShort(r.netCents)}</Slab>
                  </View>
                  <Cond size={12} color={c.ink}>{r.route}</Cond>
                  {r.clientCents != null && <Cond size={11} color={c.muted}>Prix client {eurShort(r.clientCents)} · commission {eurShort(r.commissionCents)}</Cond>}
                </View>
              ))}
            </Card>
          )}
          {d.rides.length === 0 && <Card><Slab size={15} color={c.ink} shadow={null}>Aucune course terminée sur cette période.</Slab></Card>}
          <Btn label="Exporter pour mon comptable (CSV)" onPress={exportCsv} />
        </>
      )}
    </ScrollView>
  );
}
