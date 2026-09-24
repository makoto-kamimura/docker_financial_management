// カード・電子マネー管理の「明細一覧」（web 版 /card-transactions の明細一覧タブと同じ機能）。
//   - 利用明細の手動登録（利用 / 返金）
//   - 取込時に自動でチャージ扱いにするルールの確認・削除
//   - 全件 / 実績未転記 / 実績転記済 の絞り込み
//   - 科目の紐付け・実績への転記（チャージ・チャージ入金は対象外）
//   - チャージ先の指定・解除、固定決済（毎月このカードで決済される支払い）の登録・書き換え・解除、削除
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  categorizeTransaction,
  deleteCardRecurringPayment,
  deleteCardTransaction,
  deleteCardTransferRule,
  fetchCardRecurringPayments,
  fetchCardTransactions,
  fetchCardTransferRules,
  patchCardRecurringPayment,
  postCardRecurringPayment,
  postCardTransaction,
  postTransactionToActuals,
  setCardTransactionCharge,
  type Account,
  type CardRecurringPayment,
  type CardTransaction,
  type CardTransferRule,
  type LinkedAccount,
  type ViewMode,
} from "../../api";
import { displayName } from "../../shared/display-name";
import { digitsOnly, fmtDate, yen } from "../../format";
import { TXN_SOURCE_LABEL as SOURCE_LABELS } from "../../shared/labels";
import { isChargeableType, LINKED_ACCOUNT_TYPE_LABELS } from "../../shared/linked-account-type";
import { CategoryPickerModal } from "../CategoryPickerModal";
import { ChargeLinkSheet } from "../ChargeLinkSheet";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Notice,
  Pager,
  Pills,
  SectionTitle,
  SelectField,
  SheetModal,
} from "../ui";

const POST_HELP_TEXT =
  "「転記する」を押すと、同じ摘要で科目未設定の他の明細にも自動で科目が設定されます。" +
  "また摘要のキーワードを学習し、次回以降のCSV取込・自動同期でも自動的に科目が分類されます" +
  "（分類されるのは科目のみで、転記は明細ごとに別途手動で行う必要があります）。";
const TRANSFER_HELP_TEXT =
  "デビットカード・プリペイドカード・電子マネーへのチャージは支出ではなく資金の移動なので、" +
  "収入・支出には計上しません（実際の支出はチャージ先の利用明細で計上します）。誤って指定した場合は「解除」で戻せます。";
const CHARGED_IN_HELP_TEXT =
  "他の口座・カードからのチャージとして紐付けられた入金明細です。チャージ元と対になっており、" +
  "収入として計上すると同じ資金が二重に効くため、科目の紐付けと実績への転記はできません。" +
  "「解除」を押すと紐付けが外れ、チャージ元は「履歴と未紐付け」に戻ります。";
const RECURRING_HELP_TEXT =
  "「登録する」を押すと、この明細を毎月このカードで固定決済される支払い（サブスク等）として登録します" +
  "（毎月の日付・金額・摘要は明細の内容を引き継ぎます）。カード払いは利用時点で現金が動かず、" +
  "実際の出金はカード全体の引き落とし 1 本にまとまるため、銀行の資金繰りには足し込みません。" +
  "引き落とし自体の登録は銀行管理の「振替」で行います。";
const POST_FILTER_HELP_TEXT =
  "「実績未転記」は、これから実績へ転記する明細だけを絞り込みます。チャージはそれ自体が支出ではなく" +
  "転記の対象外で、実際の支出はチャージ先の利用明細で計上するため、この絞り込みには含めません（「全件」では表示されます）。";

const PAGE_SIZE = 30;
type PostFilter = "all" | "unposted" | "posted";
const POST_FILTERS: { value: PostFilter; label: string }[] = [
  { value: "all", label: "全件" },
  { value: "unposted", label: "実績未転記" },
  { value: "posted", label: "実績転記済" },
];

const normalizeLabel = (s: string) => s.trim().toLowerCase();
// チャージ元・チャージ入金は資金の移動なので収支・転記・固定決済の対象外
const isMovement = (t: CardTransaction) =>
  t.transferToAccountId !== null || t.chargeGroupId !== null;

type Props = {
  account: LinkedAccount;
  accounts: LinkedAccount[];
  categoryAccounts: Account[];
  viewMode: ViewMode;
  /** チャージ・固定決済を変えたとき（サマリのフロー図の元データ）に呼ぶ */
  onFlowChanged: () => void;
};

export function CardTransactionsList({
  account,
  accounts,
  categoryAccounts,
  viewMode,
  onFlowChanged,
}: Props) {
  const isEMoney = account.type === "E_MONEY";
  const [txns, setTxns] = useState<CardTransaction[]>([]);
  const [recurring, setRecurring] = useState<CardRecurringPayment[]>([]);
  const [rules, setRules] = useState<CardTransferRule[]>([]);
  const [filter, setFilter] = useState<PostFilter>("all");
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [manual, setManual] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    amount: "",
    type: "charge" as "charge" | "refund",
  });
  const [picking, setPicking] = useState<CardTransaction | null>(null);
  const [actions, setActions] = useState<CardTransaction | null>(null);
  const [chargeLink, setChargeLink] = useState<{
    txn: CardTransaction;
    target: LinkedAccount;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, r, rl] = await Promise.all([
        fetchCardTransactions(account.id),
        fetchCardRecurringPayments(account.id),
        fetchCardTransferRules(account.id),
      ]);
      setTxns(t);
      setRecurring(r);
      setRules(rl);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "明細の取得に失敗しました");
    }
  }, [account.id]);

  useEffect(() => {
    setPage(0);
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "posted") return txns.filter((t) => t.postedRecordId !== null);
    if (filter === "unposted")
      return txns.filter((t) => t.postedRecordId === null && !isMovement(t));
    return txns;
  }, [txns, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const paged = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  // チャージ先に選べるのは残高を持つ決済手段（デビット・プリペイド・電子マネー）で、自分自身は除く
  const chargeTargets = accounts.filter((a) => a.id !== account.id && isChargeableType(a.type));
  // 摘要が一致する固定決済があれば「登録済み」として扱う（銀行管理の明細一覧と同じ判定）
  const matchedRecurring = (t: CardTransaction) =>
    recurring.find(
      (r) =>
        normalizeLabel(r.label) !== "" && normalizeLabel(r.label) === normalizeLabel(t.description),
    ) ?? null;

  async function run(action: () => Promise<string | void>, flowChanged = false) {
    try {
      const text = await action();
      if (text) setMsg(text);
      await load();
      if (flowChanged) onFlowChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "処理に失敗しました");
    }
  }

  function submitManual() {
    const raw = Number(manual.amount);
    if (!manual.description.trim() || !(raw > 0))
      return setMsg("摘要と金額（1 円以上）を入力してください。");
    run(async () => {
      await postCardTransaction(account.id, {
        date: manual.date,
        description: manual.description.trim(),
        // card_transactions は +利用（支出） / -返金
        amount: manual.type === "charge" ? Math.abs(raw) : -Math.abs(raw),
      });
      setManual((m) => ({ ...m, description: "", amount: "" }));
      return "登録しました";
    });
  }

  function setCharge(t: CardTransaction, to: number | null, pairTxnId: number | null = null) {
    run(async () => {
      await setCardTransactionCharge(t.id, to, pairTxnId);
      return to === null
        ? "チャージの指定を解除しました。科目の紐付け・転記ができるようになります。"
        : pairTxnId !== null
          ? "チャージ先の明細と紐付けました。両方とも収入・支出には計上されません。"
          : "チャージ（資金移動）に指定しました。収入・支出には計上されません。";
    }, true);
  }

  function confirm(title: string, message: string, onOk: () => void, destructive = false) {
    Alert.alert(title, message, [
      { text: "キャンセル", style: "cancel" },
      { text: "OK", style: destructive ? "destructive" : "default", onPress: onOk },
    ]);
  }

  const categoryLabel = (t: CardTransaction) => {
    if (!t.categoryAccount) return "科目を選択";
    const a = categoryAccounts.find((x) => x.id === t.categoryAccount!.id);
    return `${t.categoryAccount.code} ${a ? displayName(a, viewMode) : t.categoryAccount.name}`;
  };

  return (
    <View>
      {msg && (
        <TouchableOpacity onPress={() => setMsg(null)}>
          <Notice>{msg}　✕</Notice>
        </TouchableOpacity>
      )}

      <Card>
        <SectionTitle
          note={
            isEMoney
              ? "電子マネーの利用履歴（支払い・返金）を登録します。チャージ（入金）は支出ではないため、チャージ元の明細のチャージ先で指定してください（銀行から入れた場合は銀行管理の明細一覧です）。"
              : "カードの利用履歴（利用・返金）を登録します。他のカード・電子マネーへのチャージは、その明細のチャージ先で指定してください。"
          }
        >
          利用明細を手動登録
        </SectionTitle>
        <Pills
          scroll={false}
          options={[
            { value: "charge" as const, label: "利用" },
            { value: "refund" as const, label: "返金" },
          ]}
          value={manual.type}
          onChange={(type) => setManual((m) => ({ ...m, type }))}
        />
        <Field label="利用日（YYYY-MM-DD）">
          <Input value={manual.date} onChangeText={(date) => setManual((m) => ({ ...m, date }))} />
        </Field>
        <Field label="摘要（利用先）">
          <Input
            value={manual.description}
            placeholder={isEMoney ? "例: セブン-イレブン（Suica）" : "例: AMAZON.CO.JP"}
            onChangeText={(description) => setManual((m) => ({ ...m, description }))}
          />
        </Field>
        <Field label="金額（円）">
          <Input
            keyboardType="number-pad"
            value={manual.amount}
            placeholder="例: 5000"
            onChangeText={(t) => setManual((m) => ({ ...m, amount: digitsOnly(t) }))}
          />
        </Field>
        <Button label="登録する" onPress={submitManual} />
      </Card>

      {rules.length > 0 && (
        <Card>
          <SectionTitle
            note={
              "摘要が一致する明細を CSV 取込時に自動でチャージ扱いにします。削除しても、指定済みの明細はそのまま残ります。" +
              "個別の指定は明細の「操作」から行います。"
            }
          >
            取込時に自動でチャージ扱いにするルール
          </SectionTitle>
          {rules.map((r) => (
            <View key={r.id} style={s.ruleRow}>
              <Text style={s.ruleText}>
                {r.keyword} → {r.transferToAccount.name}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  confirm(
                    "ルールを削除",
                    "このルールを削除します。以後の CSV 取込では自動判定されなくなります。",
                    () =>
                      run(async () => {
                        await deleteCardTransferRule(r.id);
                        return "ルールを削除しました。指定済みの明細はそのまま残ります。";
                      }),
                  )
                }
              >
                <Text style={s.danger}>削除</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      )}

      <TouchableOpacity onPress={() => setShowHelp((v) => !v)}>
        <Text style={s.helpToggle}>
          {showHelp ? "▲ 説明を閉じる" : "？ 絞り込み・転記・チャージ・固定決済について"}
        </Text>
      </TouchableOpacity>
      {showHelp && (
        <Card>
          <Text style={s.help}>【実績未転記】{POST_FILTER_HELP_TEXT}</Text>
          <Text style={s.help}>【実績】{POST_HELP_TEXT}</Text>
          <Text style={s.help}>【チャージ】{TRANSFER_HELP_TEXT}</Text>
          <Text style={s.help}>【固定決済】{RECURRING_HELP_TEXT}</Text>
        </Card>
      )}

      <Pills
        scroll={false}
        options={POST_FILTERS}
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setPage(0);
        }}
      />
      <Text style={s.count}>
        {filtered.length} 件
        {filtered.length > 0 &&
          `（${current * PAGE_SIZE + 1}〜${Math.min((current + 1) * PAGE_SIZE, filtered.length)} 件を表示）`}
        {filter === "unposted" && "・チャージを除く"}
      </Text>

      {filtered.length === 0 ? (
        <EmptyText>
          {txns.length === 0 ? "明細がありません" : "この条件に一致する明細はありません"}
        </EmptyText>
      ) : (
        paged.map((t) => (
          <View key={t.id} style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.date}>
                {fmtDate(t.date)} · {SOURCE_LABELS[t.source] ?? t.source}
              </Text>
              <Text style={[s.amount, t.amount > 0 ? s.out : s.in]}>{yen(t.amount)}</Text>
            </View>
            <Text style={s.desc} numberOfLines={2}>
              {t.description}
            </Text>
            <View style={s.rowActions}>
              {t.transferToAccountId ? (
                <Text style={s.badge}>チャージ（{t.transferToAccount?.name ?? "指定済み"}）</Text>
              ) : t.chargeGroupId ? (
                // チャージ元の明細と対にした入金側。こちらも収支には計上しない
                <>
                  <Text style={s.badgeIn}>チャージ入金</Text>
                  <TouchableOpacity
                    onPress={() =>
                      confirm("チャージ入金の紐付けを解除", CHARGED_IN_HELP_TEXT, () =>
                        setCharge(t, null),
                      )
                    }
                  >
                    <Text style={s.subLink}>解除</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[s.chip, t.categoryAccount && s.chipSet]}
                  disabled={t.postedRecordId !== null}
                  onPress={() => setPicking(t)}
                >
                  <Text style={[s.chipText, t.categoryAccount && s.chipTextSet]} numberOfLines={1}>
                    {categoryLabel(t)}
                  </Text>
                </TouchableOpacity>
              )}
              {isMovement(t) ? (
                <Text style={s.muted}>実績対象外</Text>
              ) : t.postedRecordId !== null ? (
                <Text style={s.posted}>転記済み</Text>
              ) : (
                <TouchableOpacity
                  disabled={t.categoryAccountId === null}
                  onPress={() =>
                    run(async () => {
                      const { updatedSiblingCount: n } = await postTransactionToActuals(
                        "card",
                        t.id,
                      );
                      return n > 0
                        ? `実績へ転記しました。同じ摘要の未分類明細 ${n} 件にも科目を設定しました。`
                        : "実績へ転記しました。";
                    })
                  }
                >
                  <Text style={[s.link, t.categoryAccountId === null && s.disabled]}>転記する</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.more} onPress={() => setActions(t)}>
                <Text style={s.link}>操作 ▾</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
      {filtered.length > PAGE_SIZE && (
        <Pager
          offset={current * PAGE_SIZE}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onChange={(o) => setPage(o / PAGE_SIZE)}
        />
      )}

      <CategoryPickerModal
        visible={picking !== null}
        accounts={categoryAccounts}
        description={picking?.description}
        currentId={picking?.categoryAccountId ?? null}
        onSelect={(id) => {
          const t = picking;
          setPicking(null);
          if (t) run(() => categorizeTransaction("card", t.id, id));
        }}
        onClose={() => setPicking(null)}
      />

      {actions && (
        <CardTxnActionsSheet
          txn={actions}
          registered={matchedRecurring(actions)}
          chargeTargets={chargeTargets}
          onClose={() => setActions(null)}
          onCharge={(target) => {
            setChargeLink({ txn: actions, target });
            setActions(null);
          }}
          onUncharge={() => {
            setCharge(actions, null);
            setActions(null);
          }}
          onRegister={() => {
            const t = actions;
            setActions(null);
            const day = new Date(t.date).getDate();
            run(async () => {
              await postCardRecurringPayment({
                accountId: account.id,
                label: t.description,
                day,
                amount: Math.abs(t.amount),
                // 明細に付いている科目をそのまま引き継ぐ（未紐付けなら後から設定する）
                categoryAccountId: t.categoryAccountId,
              });
              return `毎月${day}日の固定決済として登録しました。サマリのフロー図にも表示されます。`;
            }, true);
          }}
          onRewrite={(r) => {
            const t = actions;
            setActions(null);
            const day = new Date(t.date).getDate();
            const amount = Math.round(Math.abs(t.amount));
            confirm(
              "固定決済を書き換え",
              `「${r.label}」は毎月${r.day}日・${yen(r.amount)}で登録済みです。この明細の内容（毎月${day}日・${yen(amount)}）で書き換えますか？`,
              () =>
                run(async () => {
                  await patchCardRecurringPayment(r.id, { day, amount });
                  return `毎月${day}日・${yen(amount)}に書き換えました。`;
                }, true),
            );
          }}
          onUnregister={(r) => {
            setActions(null);
            confirm("固定決済の登録を解除", `「${r.label}」の固定決済の登録を解除しますか？`, () =>
              run(async () => {
                await deleteCardRecurringPayment(r.id);
                return "固定決済の登録を解除しました。";
              }, true),
            );
          }}
          onDelete={() => {
            const t = actions;
            setActions(null);
            confirm(
              "明細を削除",
              `「${t.description}」を削除します。よろしいですか？`,
              () => run(() => deleteCardTransaction(account.id, t.id)),
              true,
            );
          }}
        />
      )}

      <ChargeLinkSheet
        source={chargeLink?.txn ?? null}
        target={chargeLink?.target ?? null}
        onCancel={() => setChargeLink(null)}
        onConfirm={(pairTxnId) => {
          if (chargeLink) setCharge(chargeLink.txn, chargeLink.target.id, pairTxnId);
          setChargeLink(null);
        }}
      />
    </View>
  );
}

function CardTxnActionsSheet({
  txn,
  registered,
  chargeTargets,
  onClose,
  onCharge,
  onUncharge,
  onRegister,
  onRewrite,
  onUnregister,
  onDelete,
}: {
  txn: CardTransaction;
  registered: CardRecurringPayment | null;
  chargeTargets: LinkedAccount[];
  onClose: () => void;
  onCharge: (target: LinkedAccount) => void;
  onUncharge: () => void;
  onRegister: () => void;
  onRewrite: (r: CardRecurringPayment) => void;
  onUnregister: (r: CardRecurringPayment) => void;
  onDelete: () => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const differs =
    registered !== null &&
    (registered.day !== new Date(txn.date).getDate() ||
      Math.round(registered.amount) !== Math.round(Math.abs(txn.amount)));

  return (
    <SheetModal
      visible
      title="明細の操作"
      subtitle={`${fmtDate(txn.date)} ${txn.description} ${yen(txn.amount)}`}
      onClose={onClose}
    >
      <Text style={s.sheetSection}>チャージ先</Text>
      {txn.transferToAccountId ? (
        <View style={s.sheetRow}>
          <Text style={s.sheetText}>
            {txn.transferToAccount?.name ?? "指定済み"}（
            {txn.chargeGroupId ? "履歴と紐付け済み" : "履歴と未紐付け"}）
          </Text>
          <Button small variant="danger" label="解除" onPress={onUncharge} />
        </View>
      ) : txn.chargeGroupId || txn.postedRecordId !== null ? (
        // 入金側は自分ではチャージ先を持たない。転記済みは先に転記の取り消しが要る
        <Text style={s.muted}>対象外</Text>
      ) : chargeTargets.length === 0 ? (
        <Text style={s.muted}>チャージ先未登録</Text>
      ) : (
        <>
          <SelectField
            label="チャージ先を選ぶ"
            value={target}
            options={chargeTargets.map((a) => ({
              value: a.id,
              label: `${a.name}（${LINKED_ACCOUNT_TYPE_LABELS[a.type]}）`,
            }))}
            onChange={setTarget}
          />
          <Button
            small
            label="指定"
            disabled={target === null}
            onPress={() => {
              const t = chargeTargets.find((a) => a.id === target);
              if (t) onCharge(t);
            }}
          />
        </>
      )}

      <Text style={s.sheetSection}>固定決済</Text>
      {isMovement(txn) ? (
        // チャージは資金の移動なので毎月の支払い項目にはしない
        <Text style={s.muted}>対象外</Text>
      ) : registered ? (
        <>
          <View style={s.sheetRow}>
            <Text style={s.sheetText}>登録済み</Text>
            <Button small variant="danger" label="解除" onPress={() => onUnregister(registered)} />
          </View>
          {differs && (
            <View style={s.sheetRow}>
              <Text style={s.muted}>
                毎月{registered.day}日 · {yen(registered.amount)}
              </Text>
              <Button
                small
                variant="secondary"
                label="この明細で書き換える"
                onPress={() => onRewrite(registered)}
              />
            </View>
          )}
        </>
      ) : (
        <Button small label="固定決済として登録する" onPress={onRegister} />
      )}

      <Text style={s.sheetSection}>削除</Text>
      <Button small variant="danger" label="この明細を削除" onPress={onDelete} />
    </SheetModal>
  );
}

const s = StyleSheet.create({
  helpToggle: { fontSize: 12, color: "#4f46e5", marginBottom: 8 },
  help: { fontSize: 11, color: "#475569", lineHeight: 17, marginBottom: 6 },
  count: { fontSize: 11, color: "#94a3b8", marginVertical: 6 },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  ruleText: { fontSize: 12, color: "#475569", flex: 1 },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  row: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { fontSize: 11, color: "#94a3b8" },
  amount: { fontSize: 14, fontWeight: "700" },
  out: { color: "#dc2626" },
  in: { color: "#059669" },
  desc: { fontSize: 13, color: "#334155", marginTop: 3 },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    flexWrap: "wrap",
  },
  chip: {
    maxWidth: 190,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  chipSet: { borderColor: "#c7d2fe", backgroundColor: "#eef2ff" },
  chipText: { fontSize: 11, color: "#94a3b8" },
  chipTextSet: { color: "#4338ca" },
  badge: {
    fontSize: 10,
    color: "#0369a1",
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  badgeIn: {
    fontSize: 10,
    color: "#047857",
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  posted: {
    fontSize: 10,
    color: "#059669",
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  subLink: { fontSize: 11, color: "#94a3b8" },
  disabled: { color: "#cbd5e1" },
  muted: { fontSize: 11, color: "#94a3b8" },
  more: { marginLeft: "auto" },
  sheetSection: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    marginTop: 14,
    marginBottom: 6,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  sheetText: { fontSize: 13, color: "#334155", flex: 1 },
});
