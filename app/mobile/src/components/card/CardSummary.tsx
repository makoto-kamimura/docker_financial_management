// カード・電子マネー管理の「サマリ」（web 版 /card-transactions のサマリタブと同じ内容）。
// 資金フロー図（引き落とし・チャージ・固定決済）と、引き落とし・固定決済スケジュール（表示のみ）。
// 登録は 引き落とし＝銀行管理の「振替」、固定決済＝明細一覧 で行う（同じ操作を 2 か所に置かない）。
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchCardFlow, type CardFlowResponse, type LinkedAccount } from "../../api";
import { yen } from "../../format";
import { LINKED_ACCOUNT_TYPE_LABELS } from "../../shared/linked-account-type";
import { AccountFlowDiagram } from "../AccountFlowDiagram";
import { Card, Notice, Pills, SectionTitle, SelectField } from "../ui";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 引き落とし（銀行 → カード）と固定決済（カード → 外部）を同じ形にそろえた 1 件
type ScheduleEntry = {
  key: string;
  day: number;
  accountId: number | null;
  from: string;
  to: string;
  amount: number;
  kindLabel: string;
  kind: "debit" | "recurring";
};

export function CardSummary({
  accounts,
  reloadKey,
}: {
  accounts: LinkedAccount[];
  reloadKey: number;
}) {
  const now = new Date();
  const [flow, setFlow] = useState<CardFlowResponse | null>(null);
  const [mode, setMode] = useState<"list" | "calendar">("list");
  const [scope, setScope] = useState<number | "all">("all");
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    setFlow(null);
    fetchCardFlow()
      .then(setFlow)
      .catch(() =>
        setFlow({
          cyclic: false,
          graph: { nodes: [], links: [] },
          chargeMonths: 3,
          unlinked: [],
          transfers: [],
          recurring: [],
        }),
      );
  }, [reloadKey]);

  const entries = useMemo<ScheduleEntry[]>(() => {
    const debits: ScheduleEntry[] = (flow?.transfers ?? []).map((t) => ({
      key: `transfer:${t.id}`,
      day: t.day,
      accountId: t.linkedAccountId,
      from: t.from ?? (t.label || "外部入金"),
      to: t.linkedAccountName ?? (t.label || "カード"),
      amount: t.amount,
      kindLabel: t.channelLabel,
      kind: "debit",
    }));
    const recurring: ScheduleEntry[] = (flow?.recurring ?? []).map((r) => ({
      key: `recurring:${r.id}`,
      day: r.day,
      accountId: r.accountId,
      from: r.accountName,
      to: r.label,
      amount: r.amount,
      kindLabel: "固定決済",
      kind: "recurring",
    }));
    return [...debits, ...recurring].sort((a, b) => a.day - b.day || a.key.localeCompare(b.key));
  }, [flow]);
  const filtered = scope === "all" ? entries : entries.filter((e) => e.accountId === scope);

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  // 予定日は「毎月◯日」なので、その月に無い日（31 日など）は月末に寄せる
  const byDay = useMemo(() => {
    const m = new Map<number, ScheduleEntry[]>();
    for (const e of filtered) {
      const day = Math.min(e.day, daysInMonth);
      m.set(day, [...(m.get(day) ?? []), e]);
    }
    return m;
  }, [filtered, daysInMonth]);

  function moveMonth(delta: number) {
    const d = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
  }

  return (
    <View>
      <Card>
        <SectionTitle
          note={
            "銀行口座からの引き落とし（銀行管理の「振替」で登録）、銀行口座やカードからデビット・プリペイド・" +
            "電子マネーへのチャージ、カードでの固定決済を 1 枚にまとめて表示します。同じ組み合わせが複数ある場合は" +
            `金額を合算して 1 本の線で描きます。チャージだけは明細の実績が元なので、直近 ${flow?.chargeMonths ?? 3} か月を` +
            "月あたりに均した額で描いています。"
          }
        >
          カード・電子マネー 資金フロー図
        </SectionTitle>
        {!flow ? (
          <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
        ) : flow.cyclic ? (
          <Notice tone="warn">
            チャージ先の指定が循環しているためフロー図を描画できません。「明細一覧」タブのチャージ先で経路を見直してください。
          </Notice>
        ) : flow.graph.links.length === 0 ? (
          <Notice>
            描画できる資金の流れがありません。「明細一覧」のチャージ先・固定決済、銀行管理の明細一覧のチャージ先、
            または銀行管理の「振替」（引き落とし）から登録してください。
          </Notice>
        ) : (
          <AccountFlowDiagram graph={flow.graph} />
        )}
        {flow && flow.unlinked.length > 0 && (
          <Notice tone="warn">
            引き落とし・チャージ・固定決済のいずれも未登録のため図に出ていません:{" "}
            {flow.unlinked.map((a) => a.name).join(" / ")}
          </Notice>
        )}
      </Card>

      <SectionTitle
        note={
          "毎月の引き落とし（銀行口座 → カード）と固定決済（このカードで毎月支払う項目）の予定日です。" +
          "ここは表示のみで、引き落としの登録は銀行管理の「振替」タブ、固定決済の登録は「明細一覧」から行います。"
        }
      >
        引き落とし・固定決済スケジュール
      </SectionTitle>
      <Pills
        scroll={false}
        options={[
          { value: "list" as const, label: "一覧モード" },
          { value: "calendar" as const, label: "スケジュールモード" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <SelectField<number | "all">
        label="対象"
        value={scope}
        options={[
          { value: "all", label: "すべてのカード・電子マネー" },
          ...accounts.map((a) => ({
            value: a.id,
            label: `[${LINKED_ACCOUNT_TYPE_LABELS[a.type] ?? "カード"}] ${a.name}`,
          })),
        ]}
        onChange={setScope}
      />

      {mode === "list" ? (
        filtered.length === 0 ? (
          <Text style={s.muted}>
            引き落とし・固定決済がまだ登録されていません。引き落としは銀行管理の「振替」タブ、固定決済は「明細一覧」から
            登録すると、この一覧と上のフロー図に表示されます。
          </Text>
        ) : (
          <Card>
            {filtered.map((e) => (
              <View key={e.key} style={s.row}>
                <Text style={s.day}>{e.day}日</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.route} numberOfLines={2}>
                    {e.from} →{" "}
                    <Text style={e.kind === "recurring" ? s.recurring : undefined}>{e.to}</Text>
                  </Text>
                  <Text style={s.muted}>{e.kindLabel}</Text>
                </View>
                <Text style={s.amount}>{yen(e.amount)}</Text>
              </View>
            ))}
          </Card>
        )
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <View style={s.monthNav}>
            <TouchableOpacity onPress={() => moveMonth(-1)} style={s.navBtn}>
              <Text style={s.navTxt}>◀</Text>
            </TouchableOpacity>
            <Text style={s.monthLabel}>
              {viewYear}年{viewMonth}月
            </Text>
            <TouchableOpacity onPress={() => moveMonth(1)} style={s.navBtn}>
              <Text style={s.navTxt}>▶</Text>
            </TouchableOpacity>
          </View>
          <View style={s.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={w} style={[s.weekCell, i === 0 && s.sun, i === 6 && s.sat]}>
                {w}
              </Text>
            ))}
          </View>
          <View style={s.grid}>
            {Array.from({ length: totalCells }, (_, i) => {
              const day = i - firstWeekday + 1;
              if (day < 1 || day > daysInMonth) return <View key={i} style={[s.cell, s.blank]} />;
              return (
                <View key={i} style={s.cell}>
                  <Text style={[s.dayNum, i % 7 === 0 && s.sun, i % 7 === 6 && s.sat]}>{day}</Text>
                  {(byDay.get(day) ?? []).map((e) => (
                    <Text
                      key={e.key}
                      style={e.kind === "recurring" ? s.cellRecurring : s.cellDebit}
                      numberOfLines={1}
                    >
                      {e.to} {yen(e.amount)}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  day: { fontSize: 12, color: "#64748b", width: 32 },
  route: { fontSize: 13, color: "#334155" },
  recurring: { color: "#e11d48", fontWeight: "600" },
  amount: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  navBtn: { padding: 8 },
  navTxt: { fontSize: 14, color: "#4f46e5" },
  monthLabel: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  weekRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  weekCell: { flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", paddingVertical: 6 },
  sun: { color: "#ef4444" },
  sat: { color: "#3b82f6" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    minHeight: 60,
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  blank: { backgroundColor: "#fafafa" },
  dayNum: { fontSize: 12, fontWeight: "600", color: "#334155" },
  cellDebit: { fontSize: 8, color: "#4f46e5" },
  cellRecurring: { fontSize: 8, color: "#e11d48" },
});
