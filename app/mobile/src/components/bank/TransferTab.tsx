// 銀行管理の「振替」タブ（web 版 /bank-accounts の振替タブと同じ構成）。
//   口座間 資金フロー図（設定ベース / 実績ベース（月次））→ 資金移動スケジュール（一覧 / スケジュール）
//   → 取込済み明細の振替紐付け。都度の振替（銀行 → 銀行）はシートから登録する。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteTransfer,
  fetchLinkedAccounts,
  fetchMonthlyCashFlow,
  fetchTransferCandidates,
  fetchTransferFlow,
  fetchTransfers,
  linkBankTransfer,
  postBankTransfer,
  postTransfer,
  type BankAccount,
  type LinkedAccount,
  type MonthlyCashFlowResponse,
  type Transfer,
  type TransferCandidate,
  type TransferFlowResponse,
} from "../../api";
import { digitsOnly, fmtDate, yen } from "../../format";
import { TRANSFER_CHANNEL_LABELS } from "../../shared/labels";
import { AccountFlowDiagram } from "../AccountFlowDiagram";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Notice,
  Pills,
  SectionTitle,
  SelectField,
  SheetModal,
} from "../ui";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 相手先の登録済み口座を紐付けられる種別。銀行振込は from / to の両方が埋まると毎月の銀行→銀行の振替になる
const PARTNER_ACCOUNT_CHANNELS = ["AUTO_DEBIT", "BANK_TRANSFER"];
const DAY_GAP_OPTIONS = [0, 1, 3, 7] as const;
const TRANSFER_MATCH_HELP_TEXT =
  "両方の口座の CSV を取り込むと、1 回の資金移動が「出金側」と「入金側」の 2 明細に分かれて入ります。" +
  "そのままどちらも科目に紐付けると支出と収入で二重に計上されるため、対になる明細どうしを振替として紐付けます。" +
  "紐付けても明細は消えないので口座残高は変わりません。変わるのは収入・支出として集計されるかどうかだけです。";

export type ScheduleMode = "list" | "calendar";
type Scope = number | "all";

const BLANK_RECURRING = {
  label: "",
  channel: "AUTO_DEBIT",
  amount: "",
  note: "",
  direction: "out" as "in" | "out",
  // 登録先の口座（空 = カレンダーの対象口座に従う）
  ownerAccountId: null as number | null,
  // 銀行引き落とし・銀行振込の相手側の登録済み口座（null = 外部）
  partnerAccountId: null as number | null,
  // カード引き落としで紐付けるカード・電子マネー
  linkedAccountId: null as number | null,
};

type Props = {
  accounts: BankAccount[];
  /** 明細一覧で選んでいる口座（スケジュールの既定の対象口座） */
  accountId: number | null;
  year: number;
  month: number;
  scheduleMode: ScheduleMode;
  onScheduleModeChange: (m: ScheduleMode) => void;
  /** 明細一覧の「スケジュールで見る」から開いたときに選ぶ日 */
  focusDay: number | null;
  /** 残高が変わる操作（振替の登録・紐付け）の後に呼ぶ */
  onBalanceChanged: () => void;
};

export function TransferTab({
  accounts,
  accountId,
  year,
  month,
  scheduleMode,
  onScheduleModeChange,
  focusDay,
  onBalanceChanged,
}: Props) {
  const [flowSource, setFlowSource] = useState<"config" | "actual">("config");
  const [flow, setFlow] = useState<TransferFlowResponse | null>(null);
  const [monthly, setMonthly] = useState<MonthlyCashFlowResponse | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [cards, setCards] = useState<LinkedAccount[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBankTransfer, setShowBankTransfer] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      const [f, t, c] = await Promise.all([
        fetchTransferFlow(),
        fetchTransfers(),
        fetchLinkedAccounts(),
      ]);
      setFlow(f);
      setTransfers(t);
      setCards(c);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "資金移動の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (flowSource !== "actual") return;
    setMonthly(null);
    fetchMonthlyCashFlow(year, month)
      .then(setMonthly)
      .catch(() => setMonthly({ year, month, graph: { nodes: [], links: [] } }));
  }, [flowSource, year, month]);

  return (
    <View>
      {msg && (
        <TouchableOpacity onPress={() => setMsg(null)}>
          <Notice>{msg}　✕</Notice>
        </TouchableOpacity>
      )}

      <Pills
        scroll={false}
        options={[
          { value: "config" as const, label: "設定ベース" },
          { value: "actual" as const, label: "実績ベース（月次）" },
        ]}
        value={flowSource}
        onChange={setFlowSource}
      />

      {flowSource === "config" ? (
        <Card>
          <SectionTitle>口座間 資金フロー図</SectionTitle>
          {!flow ? (
            <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
          ) : flow.cyclic ? (
            <Notice tone="warn">
              資金移動に循環があるためフロー図を描画できません。下のスケジュールで経路を見直してください。
            </Notice>
          ) : flow.graph.nodes.length === 0 ? (
            <EmptyText>口座間の資金移動が登録されていません。</EmptyText>
          ) : (
            <AccountFlowDiagram graph={flow.graph} />
          )}
        </Card>
      ) : (
        <Card>
          <SectionTitle
            note={
              "科目に紐付け済み（「明細一覧」タブで紐付け）の入出金明細と資金移動ルールから生成しています。" +
              `対象月の実績がまだ無い項目は、直近 ${monthly?.historyMonths ?? 3} か月の平均から推測した金額を破線（アンバー）で表示します。`
            }
          >
            {year}年{month}月 実績フロー図
          </SectionTitle>
          {!monthly ? (
            <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
          ) : monthly.graph.links.length === 0 ? (
            <Notice>
              対象月に科目紐付け済みの明細がありません。「明細一覧」タブで紐付けを行ってください。
            </Notice>
          ) : (
            <AccountFlowDiagram graph={monthly.graph} />
          )}
        </Card>
      )}

      {/* ── 資金移動スケジュール ── */}
      <SectionTitle>資金移動スケジュール</SectionTitle>
      <View style={s.scheduleHead}>
        <Pills
          scroll={false}
          options={[
            { value: "list" as const, label: "一覧モード" },
            { value: "calendar" as const, label: "スケジュールモード" },
          ]}
          value={scheduleMode}
          onChange={onScheduleModeChange}
        />
      </View>
      <Button
        label="振替を登録（銀行 → 銀行）"
        disabled={accounts.length < 2}
        onPress={() => setShowBankTransfer(true)}
        style={{ marginBottom: 10 }}
      />
      {accounts.length < 2 && <Text style={s.muted}>振替には 2 つ以上の口座の登録が必要です</Text>}

      {scheduleMode === "list" ? (
        !flow ? null : flow.transfers.length === 0 ? (
          <Text style={s.muted}>
            資金移動がまだ登録されていません。スケジュールモードのカレンダーから固定の入出金を登録すると、
            この一覧と上のフロー図に表示されます。
          </Text>
        ) : (
          <Card>
            {flow.transfers.map((t) => (
              <View key={t.id} style={s.ruleRow}>
                <Text style={s.ruleDay}>{t.day}日</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.ruleRoute} numberOfLines={2}>
                    <Text style={t.from ? undefined : s.external}>
                      {t.from ?? t.label ?? "外部入金"}
                    </Text>
                    {" → "}
                    <Text style={t.to ? undefined : s.externalOut}>
                      {t.to ?? t.label ?? "外部支出"}
                    </Text>
                  </Text>
                  <Text style={s.muted}>{t.channelLabel}</Text>
                </View>
                <Text style={s.ruleAmount}>{yen(t.amount)}</Text>
              </View>
            ))}
          </Card>
        )
      ) : (
        <ScheduleCalendar
          accounts={accounts}
          accountId={accountId}
          transfers={transfers}
          cards={cards}
          focusDay={focusDay}
          onChanged={(text) => {
            setMsg(text);
            loadRules();
          }}
          onError={setMsg}
        />
      )}

      <TransferMatchPanel
        onLinked={(text) => {
          setMsg(text);
          onBalanceChanged();
        }}
        onError={setMsg}
      />

      <BankTransferSheet
        visible={showBankTransfer}
        accounts={accounts}
        onClose={() => setShowBankTransfer(false)}
        onDone={(text) => {
          setMsg(text);
          onBalanceChanged();
        }}
      />
    </View>
  );
}

// ── 資金移動カレンダー（スケジュールモード）──────────────────────────────
function ScheduleCalendar({
  accounts,
  accountId,
  transfers: allTransfers,
  cards,
  focusDay,
  onChanged,
  onError,
}: {
  accounts: BankAccount[];
  accountId: number | null;
  transfers: Transfer[];
  cards: LinkedAccount[];
  focusDay: number | null;
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(focusDay);
  const [scope, setScope] = useState<Scope | null>(null);
  const [form, setForm] = useState(BLANK_RECURRING);
  const scopeId: Scope | null = scope ?? accountId;

  useEffect(() => {
    if (focusDay !== null) setSelectedDay(focusDay);
  }, [focusDay]);

  const transfers = useMemo(
    () =>
      allTransfers.filter(
        (t) => scopeId === "all" || t.fromAccountId === scopeId || t.toAccountId === scopeId,
      ),
    [allTransfers, scopeId],
  );
  const byDay = useMemo(() => {
    const m = new Map<number, Transfer[]>();
    for (const t of transfers) m.set(t.day, [...(m.get(t.day) ?? []), t]);
    return m;
  }, [transfers]);

  // 登録先の口座。フォームで明示指定があればそれを、無ければカレンダーの対象口座に従う
  const ownerId = form.ownerAccountId ?? (typeof scopeId === "number" ? scopeId : null);
  // 全銀行表示では基準口座が定まらないため、出金元の有無で向きを判定する（web 版と同じ）
  const isOut = (t: Transfer) =>
    scopeId === "all" ? t.fromAccountId !== null : t.fromAccountId === scopeId;
  const accountNameOf = (t: Transfer) =>
    accounts.find((a) => a.id === (t.fromAccountId ?? t.toAccountId))?.name ?? "—";

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const dayTransfers = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function moveMonth(delta: number) {
    const d = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
  }

  async function submit() {
    if (!selectedDay) return;
    if (ownerId === null) {
      onError(
        accounts.length === 0 ? "口座を登録してください。" : "登録先の口座を選択してください。",
      );
      return;
    }
    if (!(Number(form.amount) > 0)) {
      onError("金額を入力してください。");
      return;
    }
    const partnerId = PARTNER_ACCOUNT_CHANNELS.includes(form.channel)
      ? form.partnerAccountId
      : null;
    try {
      await postTransfer({
        fromAccountId: form.direction === "out" ? ownerId : partnerId,
        toAccountId: form.direction === "in" ? ownerId : partnerId,
        label: form.label || null,
        channel: form.channel,
        day: selectedDay,
        amount: Number(form.amount),
        note: form.note || null,
        linkedAccountId: form.channel === "CARD_PAYMENT" ? form.linkedAccountId : null,
      });
      setForm(BLANK_RECURRING);
      onChanged("追加しました");
    } catch (e) {
      onError(`追加に失敗しました: ${e instanceof Error ? e.message : "エラー"}`);
    }
  }

  function remove(t: Transfer) {
    Alert.alert("固定入出金を削除", `「${t.label ?? "—"}」を削除します。よろしいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTransfer(t.id);
            onChanged("削除しました");
          } catch (e) {
            onError(e instanceof Error ? e.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  return (
    <View>
      <Text style={s.muted}>
        毎月の引き落とし・入金の予定日を確認し、日付をタップして追加・削除できます。ここで変わるのは固定入出金
        （毎月の資金移動ルール）だけで、取り込み済みの明細や口座残高は変わりません。
      </Text>
      <SelectField<number | "all">
        label="対象口座"
        value={scopeId}
        options={[
          { value: "all", label: "すべての銀行" },
          ...accounts.map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` })),
        ]}
        onChange={(v) => {
          setScope(v);
          setSelectedDay(null);
          setForm((f) => ({ ...f, ownerAccountId: null, partnerAccountId: null }));
        }}
      />
      <Text style={s.muted}>
        {scopeId === "all"
          ? `全 ${accounts.length} 口座の資金移動 ${transfers.length} 件を表示しています`
          : `この口座の資金移動 ${transfers.length} 件を表示しています`}
      </Text>

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
            if (day < 1 || day > daysInMonth)
              return <View key={i} style={[s.dayCell, s.dayBlank]} />;
            const list = byDay.get(day) ?? [];
            return (
              <TouchableOpacity
                key={i}
                style={[s.dayCell, day === selectedDay && s.daySelected]}
                onPress={() => setSelectedDay(day)}
              >
                <Text style={[s.dayNum, i % 7 === 0 && s.sun, i % 7 === 6 && s.sat]}>{day}</Text>
                {list.slice(0, 2).map((t) => (
                  <Text key={t.id} style={isOut(t) ? s.dayOut : s.dayIn} numberOfLines={1}>
                    {isOut(t) ? "−" : "+"}
                    {t.label ?? TRANSFER_CHANNEL_LABELS[t.channel] ?? t.channel}
                  </Text>
                ))}
                {list.length > 2 && <Text style={s.dayMore}>他{list.length - 2}件</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {selectedDay === null ? (
        <EmptyText>カレンダーの日付をタップして固定の入出金を確認・追加</EmptyText>
      ) : (
        <>
          <Card>
            <Text style={s.dayTitle}>
              毎月{selectedDay}日 —{" "}
              {typeof scopeId === "number"
                ? (accounts.find((a) => a.id === scopeId)?.name ?? "この口座")
                : "すべての銀行"}
            </Text>
            <Text style={s.muted}>{dayTransfers.length} 件の固定入出金</Text>
            {dayTransfers.map((t) => {
              const out = isOut(t);
              const partner = out ? t.toAccount : t.fromAccount;
              return (
                <View key={t.id} style={s.dayRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dayLabel} numberOfLines={1}>
                      {t.label ?? "—"}
                    </Text>
                    <Text style={s.muted} numberOfLines={1}>
                      {scopeId === "all" ? `${accountNameOf(t)} · ` : ""}
                      {TRANSFER_CHANNEL_LABELS[t.channel] ?? t.channel}
                      {t.linkedAccount
                        ? ` · ${t.linkedAccount.name}`
                        : partner
                          ? ` · ${partner.name}`
                          : " · 外部"}
                    </Text>
                  </View>
                  <Text style={out ? s.out : s.in}>
                    {out ? "−" : "+"}
                    {yen(t.amount)}
                  </Text>
                  <TouchableOpacity onPress={() => remove(t)} hitSlop={8}>
                    <Text style={s.remove}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </Card>

          <Card>
            <Text style={s.formTitle}>毎月{selectedDay}日 の入出金を追加</Text>
            <SelectField
              label="登録先の口座（この口座の入出金として登録）"
              value={ownerId}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` }))}
              onChange={(id) =>
                setForm((f) => ({
                  ...f,
                  ownerAccountId: id,
                  // 登録先を変えたら、同じ口座が相手先に残らないようにする
                  partnerAccountId: f.partnerAccountId === id ? null : f.partnerAccountId,
                }))
              }
            />
            <Pills
              scroll={false}
              options={[
                { value: "out" as const, label: "出金（支払）" },
                { value: "in" as const, label: "入金（受取）" },
              ]}
              value={form.direction}
              onChange={(direction) => setForm((f) => ({ ...f, direction }))}
            />
            <Field label="ラベル（任意）">
              <Input
                value={form.label}
                placeholder="例: 家賃・給与振込"
                onChangeText={(label) => setForm((f) => ({ ...f, label }))}
              />
            </Field>
            <Field label="種別">
              <Pills
                scroll={false}
                options={Object.entries(TRANSFER_CHANNEL_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={form.channel}
                onChange={(channel) => setForm((f) => ({ ...f, channel }))}
              />
            </Field>
            {PARTNER_ACCOUNT_CHANNELS.includes(form.channel) && (
              <>
                <SelectField<number | 0>
                  label={
                    form.direction === "out"
                      ? form.channel === "BANK_TRANSFER"
                        ? "相手先の口座＝振込先（任意）"
                        : "相手先の口座＝引き落とし先（任意）"
                      : form.channel === "BANK_TRANSFER"
                        ? "相手先の口座＝振込元（任意）"
                        : "相手先の口座＝入金元（任意）"
                  }
                  value={form.partnerAccountId ?? 0}
                  options={[
                    { value: 0, label: "外部（登録口座以外）" },
                    ...accounts
                      .filter((a) => a.id !== ownerId)
                      .map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` })),
                  ]}
                  onChange={(id) =>
                    setForm((f) => ({ ...f, partnerAccountId: id === 0 ? null : id }))
                  }
                />
                <Text style={s.muted}>
                  {form.channel === "BANK_TRANSFER"
                    ? "登録済みの口座を選ぶと、毎月の銀行→銀行の振替として両方の口座に反映されます。相手が登録口座以外なら「外部」のままで構いません。"
                    : form.direction === "out"
                      ? "上の「登録先の口座」から引き落とされます。相手が登録口座以外（家賃・公共料金など）なら「外部」のままで構いません。"
                      : "上の「登録先の口座」へ入金されます。振込元が登録口座以外（給与など）なら「外部」のままで構いません。"}
                </Text>
              </>
            )}
            {form.channel === "CARD_PAYMENT" && (
              <>
                <SelectField<number | 0>
                  label="紐付けるカード・電子マネー"
                  value={form.linkedAccountId ?? 0}
                  options={[
                    { value: 0, label: "未紐付け" },
                    ...cards.map((c) => ({ value: c.id, label: `${c.name}（${c.institution}）` })),
                  ]}
                  onChange={(id) =>
                    setForm((f) => ({ ...f, linkedAccountId: id === 0 ? null : id }))
                  }
                />
                {cards.length === 0 && (
                  <Text style={s.muted}>
                    「カード・電子マネー管理」でカードを登録すると選べます。
                  </Text>
                )}
              </>
            )}
            <Field label="金額（円）">
              <Input
                keyboardType="number-pad"
                value={form.amount}
                placeholder="例: 90000"
                onChangeText={(t) => setForm((f) => ({ ...f, amount: digitsOnly(t) }))}
              />
            </Field>
            <Field label="メモ（任意）">
              <Input
                value={form.note}
                placeholder="備考"
                onChangeText={(note) => setForm((f) => ({ ...f, note }))}
              />
            </Field>
            <Button label="追加" onPress={submit} />
          </Card>
        </>
      )}
    </View>
  );
}

// ── 取込済み明細の振替紐付け ──────────────────────────────────────────
function TransferMatchPanel({
  onLinked,
  onError,
}: {
  onLinked: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [dayGap, setDayGap] = useState(3);
  const [data, setData] = useState<{ data: TransferCandidate[]; total: number } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(() => {
    setData(null);
    fetchTransferCandidates(dayGap)
      .then(setData)
      .catch(() => setData({ data: [], total: 0 }));
  }, [dayGap]);

  useEffect(() => {
    load();
  }, [load]);

  function link(c: TransferCandidate) {
    const hasCategory = c.out.categoryAccountId !== null || c.in.categoryAccountId !== null;
    Alert.alert(
      "振替として紐付け",
      `出金 ${fmtDate(c.out.date)} ${c.out.accountName}（${c.out.description}）\n` +
        `入金 ${fmtDate(c.in.date)} ${c.in.accountName}（${c.in.description}）\n金額 ${yen(c.amount)}\n\n` +
        "紐付けると収入・支出には計上されなくなります（口座残高は変わりません）。" +
        (hasCategory ? "\n付いている科目の紐付けは解除されます。" : ""),
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "紐付ける",
          onPress: async () => {
            const key = `${c.out.id}-${c.in.id}`;
            setLinking(key);
            try {
              await linkBankTransfer(c.out.id, c.in.id);
              onLinked("振替として紐付けました。両方の明細が収入・支出の集計から外れます。");
              load();
            } catch (e) {
              onError(`紐付けに失敗しました: ${e instanceof Error ? e.message : "エラー"}`);
            } finally {
              setLinking(null);
            }
          },
        },
      ],
    );
  }

  return (
    <Card>
      <View style={s.matchHead}>
        <Text style={s.formTitle}>取込済み明細の振替紐付け</Text>
        <TouchableOpacity onPress={() => setShowHelp((v) => !v)} hitSlop={8}>
          <Text style={s.helpIcon}>?</Text>
        </TouchableOpacity>
      </View>
      {showHelp && <Text style={s.help}>{TRANSFER_MATCH_HELP_TEXT}</Text>}
      <Field label="日付のずれ">
        <Pills
          scroll={false}
          options={DAY_GAP_OPTIONS.map((d) => ({
            value: d as number,
            label: d === 0 ? "同じ日のみ" : `${d}日以内`,
          }))}
          value={dayGap}
          onChange={setDayGap}
        />
      </Field>
      {data === null ? (
        <Text style={s.muted}>候補を探しています…</Text>
      ) : data.data.length === 0 ? (
        <Text style={s.muted}>
          振替の対になりそうな明細は見つかりませんでした。着金が数日ずれている場合は「日付のずれ」を広げてみてください。
        </Text>
      ) : (
        <>
          <Text style={s.muted}>
            同額・符号が逆・別口座の明細の組です（{data.total} 件
            {data.total > data.data.length ? `のうち ${data.data.length} 件を表示` : ""}
            ）。機械的な突き合わせなので、内容を確かめてから紐付けてください。
          </Text>
          {data.data.map((c) => {
            const key = `${c.out.id}-${c.in.id}`;
            return (
              <View key={key} style={s.matchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.matchSide}>
                    出金 {fmtDate(c.out.date)}・{c.out.accountName}
                  </Text>
                  <Text style={s.dayLabel} numberOfLines={1}>
                    {c.out.description}
                  </Text>
                  <Text style={s.matchSide}>
                    入金 {fmtDate(c.in.date)}・{c.in.accountName}
                  </Text>
                  <Text style={s.dayLabel} numberOfLines={1}>
                    {c.in.description}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={s.ruleAmount}>{yen(c.amount)}</Text>
                  <Text style={s.muted}>{c.dayGap === 0 ? "同じ日" : `${c.dayGap}日`}</Text>
                  <Button
                    small
                    variant="secondary"
                    label={linking === key ? "紐付け中…" : "振替として紐付ける"}
                    disabled={linking !== null}
                    onPress={() => link(c)}
                  />
                </View>
              </View>
            );
          })}
        </>
      )}
    </Card>
  );
}

// ── 都度の振替（銀行 → 銀行）。出金元・入金先の両方に明細を作る ───────────────
function BankTransferSheet({
  visible,
  accounts,
  onClose,
  onDone,
}: {
  visible: boolean;
  accounts: BankAccount[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fromAccountId: null as number | null,
    toAccountId: null as number | null,
    amount: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.fromAccountId || !form.toAccountId)
      return setError("出金元と入金先の口座を選択してください。");
    if (form.fromAccountId === form.toAccountId)
      return setError("出金元と入金先が同じです。別の口座を選択してください。");
    if (!(Number(form.amount) > 0)) return setError("金額を入力してください。");
    setSaving(true);
    setError(null);
    try {
      await postBankTransfer({
        date: form.date,
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: Number(form.amount),
        description: form.description || null,
      });
      // 日付は続けて登録しやすいよう残す
      setForm((f) => ({
        ...f,
        fromAccountId: null,
        toAccountId: null,
        amount: "",
        description: "",
      }));
      onDone("振替を登録しました。出金元・入金先の両方の明細に反映されます。");
      onClose();
    } catch (e) {
      setError(`振替の登録に失敗しました: ${e instanceof Error ? e.message : "エラー"}`);
    } finally {
      setSaving(false);
    }
  }

  const options = accounts.map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` }));
  return (
    <SheetModal
      visible={visible}
      title="振替を登録（銀行 → 銀行）"
      subtitle="両方の口座に明細を作ります。自己資金の移動なので収入・支出には計上されません。"
      onClose={onClose}
      footer={<Button label="振替を登録" onPress={submit} loading={saving} />}
    >
      <Field label="日付（YYYY-MM-DD）">
        <Input value={form.date} onChangeText={(date) => setForm((f) => ({ ...f, date }))} />
      </Field>
      <SelectField
        label="出金元の口座"
        value={form.fromAccountId}
        options={options}
        onChange={(id) => setForm((f) => ({ ...f, fromAccountId: id }))}
      />
      <SelectField
        label="入金先の口座"
        value={form.toAccountId}
        options={options.filter((o) => o.value !== form.fromAccountId)}
        onChange={(id) => setForm((f) => ({ ...f, toAccountId: id }))}
      />
      <Field label="金額（円）">
        <Input
          keyboardType="number-pad"
          value={form.amount}
          placeholder="例: 50000"
          onChangeText={(t) => setForm((f) => ({ ...f, amount: digitsOnly(t) }))}
        />
      </Field>
      <Field label="摘要（任意）">
        <Input
          value={form.description}
          placeholder="未入力なら相手口座名から自動作成"
          onChangeText={(description) => setForm((f) => ({ ...f, description }))}
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </SheetModal>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 11, color: "#94a3b8", marginBottom: 8, lineHeight: 16 },
  help: { fontSize: 11, color: "#475569", lineHeight: 17, marginBottom: 8 },
  helpIcon: {
    fontSize: 10,
    color: "#64748b",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    width: 16,
    height: 16,
    textAlign: "center",
    lineHeight: 14,
  },
  scheduleHead: { marginBottom: 8 },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  ruleDay: { fontSize: 12, color: "#64748b", width: 32 },
  ruleRoute: { fontSize: 13, color: "#334155" },
  external: { color: "#059669", fontWeight: "600" },
  externalOut: { color: "#e11d48", fontWeight: "600" },
  ruleAmount: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
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
  dayCell: {
    width: `${100 / 7}%`,
    minHeight: 60,
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  dayBlank: { backgroundColor: "#fafafa" },
  daySelected: { backgroundColor: "#eef2ff" },
  dayNum: { fontSize: 12, fontWeight: "600", color: "#334155" },
  dayOut: { fontSize: 8, color: "#e11d48" },
  dayIn: { fontSize: 8, color: "#059669" },
  dayMore: { fontSize: 8, color: "#94a3b8" },
  dayTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  dayLabel: { fontSize: 13, color: "#1e293b" },
  out: { fontSize: 12, fontWeight: "700", color: "#e11d48" },
  in: { fontSize: 12, fontWeight: "700", color: "#059669" },
  remove: { fontSize: 13, color: "#cbd5e1", paddingHorizontal: 4 },
  formTitle: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 8 },
  matchHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  matchRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  matchSide: { fontSize: 10, color: "#64748b", marginTop: 2 },
});
