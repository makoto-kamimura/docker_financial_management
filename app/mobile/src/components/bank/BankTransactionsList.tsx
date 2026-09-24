// 銀行管理の「明細一覧」（web 版 BankTransactionsPanel の list ビューと同じ機能）。
//   - 入出金の手動登録
//   - 科目の紐付け・実績への転記（振替・チャージの明細は対象外）
//   - チャージ先（デビット / プリペイド / 電子マネー）の指定・解除
//   - 明細から固定入出金（毎月の資金移動ルール）を登録・書き換え
//   - 振替の紐付け解除・明細の削除
// 列が多いので、科目と転記は行に並べ、残りの操作は行の「操作」シートにまとめる。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  categorizeTransaction,
  deleteBankTransaction,
  fetchBankTransactions,
  fetchLinkedAccounts,
  fetchTransfers,
  patchTransfer,
  postBankTransaction,
  postTransactionToActuals,
  postTransfer,
  setBankTransactionCharge,
  unlinkBankTransfer,
  type Account,
  type BankAccount,
  type BankTransaction,
  type LinkedAccount,
  type Transfer,
  type ViewMode,
} from "../../api";
import { displayName } from "../../shared/display-name";
import { digitsOnly, fmtDate, yen } from "../../format";
import { TRANSFER_CHANNEL_LABELS, TXN_SOURCE_LABEL as SOURCE_LABELS } from "../../shared/labels";
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

// 列の説明（web 版と同じ文言）
const POST_HELP_TEXT =
  "「転記する」を押すと、同じ摘要で科目未設定の他の明細にも自動で科目が設定されます。" +
  "また摘要のキーワードを学習し、次回以降のCSV取込・自動同期でも自動的に科目が分類されます" +
  "（分類されるのは科目のみで、転記は明細ごとに別途手動で行う必要があります）。";
const CATEGORY_HELP_TEXT =
  "科目は「そのお金が最終的に何に使われたか」で登録します。" +
  "カード・電子マネーへのチャージや引き落としなど、他の項目で既に計上している支払いには" +
  "科目を紐付けないでください（二重計上になります）。";
const CHARGE_HELP_TEXT =
  "この出金がデビットカード・プリペイドカード・電子マネー（Suica・PayPay 等）へのチャージなら、" +
  "チャージ先を選んで指定します。チャージは支出ではなく資金の移動なので、指定した明細は収入・支出に" +
  "計上されなくなり、付いている科目は外れます（実際の支出はチャージ先の利用明細で計上します）。";
const RECURRING_HELP_TEXT =
  "種別を選んで「登録する」を押すと、この明細を毎月の支払い・入金項目として登録します" +
  "（毎月の日付・金額・摘要は明細の内容を引き継ぎます）。登録した項目は振替タブの" +
  "スケジュールと資金フローに反映されます。";
const TRANSFER_HELP_TEXT =
  "口座間の振替として登録された明細です。自己資金の移動なので収入・支出には計上せず、" +
  "科目の紐付けと実績への転記はできません（残高にのみ反映されます）。削除すると相手口座の明細も一緒に削除されます。";

const PAGE_SIZE = 30;
const todayIso = () => new Date().toISOString().slice(0, 10);

const normalizeLabel = (s: string) => s.trim().toLowerCase();

type Props = {
  accounts: BankAccount[];
  accountId: number | null;
  onAccountIdChange: (id: number) => void;
  categoryAccounts: Account[];
  viewMode: ViewMode;
  /** 明細の日付を振替タブのスケジュールで開く */
  onOpenCalendar: (date: string) => void;
  /** 残高が変わる操作（登録・削除・振替解除）の後に呼ぶ */
  onBalanceChanged: () => void;
};

export function BankTransactionsList({
  accounts,
  accountId,
  onAccountIdChange,
  categoryAccounts,
  viewMode,
  onOpenCalendar,
  onBalanceChanged,
}: Props) {
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [cards, setCards] = useState<LinkedAccount[]>([]);
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [manual, setManual] = useState({
    date: todayIso(),
    description: "",
    amount: "",
    type: "expense" as "income" | "expense",
  });
  const [picking, setPicking] = useState<BankTransaction | null>(null);
  const [actions, setActions] = useState<BankTransaction | null>(null);
  const [chargeLink, setChargeLink] = useState<{
    txn: BankTransaction;
    target: LinkedAccount;
  } | null>(null);

  const load = useCallback(async () => {
    if (accountId === null) return;
    try {
      const [t, tr, c] = await Promise.all([
        fetchBankTransactions(accountId),
        fetchTransfers(),
        fetchLinkedAccounts(),
      ]);
      setTxns(t);
      setTransfers(tr);
      setCards(c);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "明細の取得に失敗しました");
    }
  }, [accountId]);

  useEffect(() => {
    setPage(0);
    load();
  }, [load]);

  const chargeTargets = useMemo(() => cards.filter((c) => isChargeableType(c.type)), [cards]);

  // この口座の固定入出金。「毎月◯日・同額・同じ摘要」の完全一致に加えて、
  // 摘要が一致するだけでも登録済みとみなす（金額改定・日付変更されたケース。web 版と同じ）
  const accountTransfers = useMemo(
    () => transfers.filter((t) => t.fromAccountId === accountId || t.toAccountId === accountId),
    [transfers, accountId],
  );
  const matchedTransfer = (t: BankTransaction): Transfer | null => {
    const day = new Date(t.date).getDate();
    const amount = Math.round(Math.abs(t.amount));
    const label = normalizeLabel(t.description);
    return (
      accountTransfers.find(
        (tr) =>
          tr.day === day &&
          Math.round(tr.amount) === amount &&
          normalizeLabel(tr.label ?? "") === label,
      ) ??
      accountTransfers.find((tr) => label !== "" && normalizeLabel(tr.label ?? "") === label) ??
      null
    );
  };
  const differsFromTxn = (tr: Transfer, t: BankTransaction) =>
    tr.day !== new Date(t.date).getDate() ||
    Math.round(tr.amount) !== Math.round(Math.abs(t.amount));

  const pageCount = Math.max(1, Math.ceil(txns.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const paged = txns.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  async function run(action: () => Promise<string | void>, balanceChanged = false) {
    try {
      const text = await action();
      if (text) setMsg(text);
      await load();
      if (balanceChanged) onBalanceChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "処理に失敗しました");
    }
  }

  function submitManual() {
    if (accountId === null) return setMsg("口座を登録してください。");
    const raw = Number(manual.amount);
    if (!manual.description.trim() || !(raw > 0)) return setMsg("摘要と金額を入力してください。");
    run(async () => {
      await postBankTransaction(accountId, {
        date: manual.date,
        description: manual.description.trim(),
        amount: manual.type === "expense" ? -Math.abs(raw) : Math.abs(raw),
      });
      setManual((m) => ({ ...m, description: "", amount: "" }));
      return "登録しました";
    }, true);
  }

  function post(t: BankTransaction) {
    run(async () => {
      const { updatedSiblingCount: n } = await postTransactionToActuals("bank", t.id);
      return n > 0
        ? `実績へ転記しました。同じ摘要の未分類明細 ${n} 件にも科目を設定しました。`
        : "実績へ転記しました。";
    });
  }

  function unlink(t: BankTransaction) {
    Alert.alert(
      "振替の紐付けを解除",
      "明細は両方とも残るため口座残高は変わりませんが、以後それぞれ科目の紐付け・実績への転記ができるようになります。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "解除",
          onPress: () =>
            run(async () => {
              await unlinkBankTransfer(t.transferGroupId!);
              return "振替の紐付けを解除しました。";
            }, true),
        },
      ],
    );
  }

  function setCharge(
    t: BankTransaction,
    chargeToAccountId: number | null,
    pairTxnId: number | null = null,
  ) {
    run(async () => {
      await setBankTransactionCharge(t.id, chargeToAccountId, pairTxnId);
      return chargeToAccountId === null
        ? "チャージの指定を解除しました。科目の紐付け・転記ができるようになります。"
        : pairTxnId !== null
          ? "チャージ先の明細と紐付けました。両方とも収入・支出には計上されません。"
          : "チャージ（資金移動）に指定しました。収入・支出には計上されません。";
    });
  }

  function registerRecurring(t: BankTransaction, channel: string, cardId: number | null) {
    if (accountId === null) return;
    const isOut = t.amount < 0;
    const day = new Date(t.date).getDate();
    run(async () => {
      await postTransfer({
        fromAccountId: isOut ? accountId : null,
        toAccountId: isOut ? null : accountId,
        label: t.description,
        channel,
        day,
        amount: Math.abs(t.amount),
        linkedAccountId: channel === "CARD_PAYMENT" ? cardId : null,
      });
      return `毎月${day}日の${TRANSFER_CHANNEL_LABELS[channel] ?? channel}として登録しました。スケジュールにも表示されます。`;
    });
  }

  function rewriteRecurring(tr: Transfer, t: BankTransaction) {
    const day = new Date(t.date).getDate();
    const amount = Math.round(Math.abs(t.amount));
    Alert.alert(
      "固定入出金を書き換え",
      `「${tr.label ?? "（ラベルなし）"}」は毎月${tr.day}日・${yen(tr.amount)}で登録済みです。` +
        `この明細の内容（毎月${day}日・${yen(amount)}）で書き換えますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "書き換える",
          onPress: () =>
            run(async () => {
              await patchTransfer(tr.id, { day, amount, label: t.description });
              return `毎月${day}日・${yen(amount)}に書き換えました。スケジュールと資金移動にも反映されます。`;
            }),
        },
      ],
    );
  }

  function remove(t: BankTransaction) {
    Alert.alert(
      "明細を削除",
      t.transferGroupId
        ? "振替の明細です。削除すると相手口座の明細も一緒に削除されます。"
        : `「${t.description}」を削除します。よろしいですか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => {
            setActions(null);
            run(() => deleteBankTransaction(accountId!, t.id), true);
          },
        },
      ],
    );
  }

  const categoryLabel = (t: BankTransaction) => {
    if (!t.categoryAccount) return "科目を選択";
    const a = categoryAccounts.find((x) => x.id === t.categoryAccount!.id);
    return `${t.categoryAccount.code} ${a ? displayName(a, viewMode) : t.categoryAccount.name}`;
  };

  return (
    <View>
      <SelectField
        label="口座"
        value={accountId}
        options={accounts.map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` }))}
        onChange={onAccountIdChange}
      />
      {accounts.length === 0 && (
        <Notice tone="warn">
          口座が登録されていません。入出金を記録するには、先に「サマリ」の「銀行追加」から口座を登録してください。
        </Notice>
      )}
      {msg && (
        <TouchableOpacity onPress={() => setMsg(null)}>
          <Notice>{msg}　✕</Notice>
        </TouchableOpacity>
      )}

      <Card>
        <SectionTitle>入出金を手動登録</SectionTitle>
        <Pills
          scroll={false}
          options={[
            { value: "expense" as const, label: "支出" },
            { value: "income" as const, label: "収入" },
          ]}
          value={manual.type}
          onChange={(type) => setManual((m) => ({ ...m, type }))}
        />
        <Field label="日付（YYYY-MM-DD）">
          <Input value={manual.date} onChangeText={(date) => setManual((m) => ({ ...m, date }))} />
        </Field>
        <Field label="摘要">
          <Input
            value={manual.description}
            placeholder="例: 食料品"
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

      <TouchableOpacity onPress={() => setShowHelp((v) => !v)}>
        <Text style={s.helpToggle}>
          {showHelp ? "▲ 説明を閉じる" : "？ 科目・転記・チャージ・固定入出金について"}
        </Text>
      </TouchableOpacity>
      {showHelp && (
        <Card>
          <Text style={s.help}>【科目】{CATEGORY_HELP_TEXT}</Text>
          <Text style={s.help}>【実績】{POST_HELP_TEXT}</Text>
          <Text style={s.help}>【チャージ先】{CHARGE_HELP_TEXT}</Text>
          <Text style={s.help}>【固定入出金】{RECURRING_HELP_TEXT}</Text>
        </Card>
      )}

      {txns.length > 0 && (
        <Text style={s.count}>
          全 {txns.length} 件中 {current * PAGE_SIZE + 1}〜
          {Math.min((current + 1) * PAGE_SIZE, txns.length)} 件を表示
        </Text>
      )}
      {txns.length === 0 ? (
        <EmptyText>明細がありません</EmptyText>
      ) : (
        paged.map((t) => {
          const excluded = t.transferGroupId !== null || t.chargeToAccountId !== null;
          return (
            <View key={t.id} style={s.row}>
              <View style={s.rowHead}>
                <Text style={s.date}>
                  {fmtDate(t.date)} · {SOURCE_LABELS[t.source] ?? t.source}
                </Text>
                <Text style={[s.amount, t.amount < 0 ? s.out : s.in]}>{yen(t.amount)}</Text>
              </View>
              <Text style={s.desc} numberOfLines={2}>
                {t.description}
              </Text>
              <View style={s.rowActions}>
                {t.transferGroupId ? (
                  <>
                    <Text style={s.badge}>振替</Text>
                    <TouchableOpacity onPress={() => unlink(t)}>
                      <Text style={s.subLink}>解除</Text>
                    </TouchableOpacity>
                  </>
                ) : t.chargeToAccountId ? (
                  <Text style={s.badge}>チャージ（{t.chargeToAccount?.name ?? "指定済み"}）</Text>
                ) : (
                  <TouchableOpacity
                    style={[s.chip, t.categoryAccount && s.chipSet]}
                    disabled={t.postedRecordId !== null}
                    onPress={() => setPicking(t)}
                  >
                    <Text
                      style={[s.chipText, t.categoryAccount && s.chipTextSet]}
                      numberOfLines={1}
                    >
                      {categoryLabel(t)}
                    </Text>
                  </TouchableOpacity>
                )}
                {excluded ? (
                  <Text style={s.muted}>実績対象外</Text>
                ) : t.postedRecordId !== null ? (
                  <Text style={s.posted}>転記済み</Text>
                ) : (
                  <TouchableOpacity disabled={t.categoryAccountId === null} onPress={() => post(t)}>
                    <Text style={[s.link, t.categoryAccountId === null && s.disabled]}>
                      転記する
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.more} onPress={() => setActions(t)}>
                  <Text style={s.link}>操作 ▾</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
      {txns.length > PAGE_SIZE && (
        <Pager
          offset={current * PAGE_SIZE}
          total={txns.length}
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
          if (t) run(() => categorizeTransaction("bank", t.id, id));
        }}
        onClose={() => setPicking(null)}
      />

      {actions && (
        <TxnActionsSheet
          txn={actions}
          registered={matchedTransfer(actions)}
          differs={(tr) => differsFromTxn(tr, actions)}
          chargeTargets={chargeTargets}
          cards={cards}
          onClose={() => setActions(null)}
          onCharge={(target) => {
            setChargeLink({ txn: actions, target });
            setActions(null);
          }}
          onUncharge={() => {
            setCharge(actions, null);
            setActions(null);
          }}
          onRegister={(channel, cardId) => {
            registerRecurring(actions, channel, cardId);
            setActions(null);
          }}
          onRewrite={(tr) => {
            rewriteRecurring(tr, actions);
            setActions(null);
          }}
          onOpenCalendar={() => {
            onOpenCalendar(actions.date);
            setActions(null);
          }}
          onDelete={() => remove(actions)}
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

// 明細 1 件の「操作」シート（チャージ先・固定入出金・削除）
function TxnActionsSheet({
  txn,
  registered,
  differs,
  chargeTargets,
  cards,
  onClose,
  onCharge,
  onUncharge,
  onRegister,
  onRewrite,
  onOpenCalendar,
  onDelete,
}: {
  txn: BankTransaction;
  registered: Transfer | null;
  differs: (tr: Transfer) => boolean;
  chargeTargets: LinkedAccount[];
  cards: LinkedAccount[];
  onClose: () => void;
  onCharge: (target: LinkedAccount) => void;
  onUncharge: () => void;
  onRegister: (channel: string, cardId: number | null) => void;
  onRewrite: (tr: Transfer) => void;
  onOpenCalendar: () => void;
  onDelete: () => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const [channel, setChannel] = useState(txn.amount < 0 ? "AUTO_DEBIT" : "INCOME");
  const [cardId, setCardId] = useState<number | null>(null);
  const excluded = txn.transferGroupId !== null || txn.chargeToAccountId !== null;

  return (
    <SheetModal
      visible
      title="明細の操作"
      subtitle={`${fmtDate(txn.date)} ${txn.description} ${yen(txn.amount)}`}
      onClose={onClose}
    >
      <Text style={s.sheetSection}>チャージ先</Text>
      {txn.transferGroupId && <Text style={s.help}>{TRANSFER_HELP_TEXT}</Text>}
      {txn.chargeToAccountId ? (
        <View style={s.sheetRow}>
          <Text style={s.sheetText}>
            {txn.chargeToAccount?.name ?? "指定済み"}（
            {txn.chargeGroupId ? "履歴と紐付け済み" : "履歴と未紐付け"}）
          </Text>
          <Button small variant="danger" label="解除" onPress={onUncharge} />
        </View>
      ) : txn.transferGroupId || txn.postedRecordId !== null ? (
        // 振替として紐付け済み・転記済みの明細は先にそちらを外す必要がある
        <Text style={s.muted}>対象外（振替・転記済みの明細）</Text>
      ) : txn.amount >= 0 ? (
        <Text style={s.muted}>チャージは口座からの出金のみ指定できます</Text>
      ) : chargeTargets.length === 0 ? (
        <Text style={s.muted}>チャージ先未登録（カード・電子マネー管理で登録すると選べます）</Text>
      ) : (
        <>
          <SelectField
            label="チャージ先を選ぶ"
            value={target}
            options={chargeTargets.map((c) => ({
              value: c.id,
              label: `${c.name}（${LINKED_ACCOUNT_TYPE_LABELS[c.type] ?? c.type}）`,
            }))}
            onChange={setTarget}
          />
          <Button
            small
            label="指定"
            disabled={target === null}
            onPress={() => {
              const t = chargeTargets.find((c) => c.id === target);
              if (t) onCharge(t);
            }}
          />
        </>
      )}

      <Text style={s.sheetSection}>固定入出金</Text>
      {excluded ? (
        // 振替は毎月の固定入出金として登録しない（登録するなら資金移動ルール側で「銀行振込」＋相手口座を指定する）
        <Text style={s.muted}>対象外</Text>
      ) : registered ? (
        <View>
          <View style={s.sheetRow}>
            <Text style={s.sheetText}>登録済み</Text>
            <Button small variant="secondary" label="スケジュールで見る" onPress={onOpenCalendar} />
          </View>
          {differs(registered) && (
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
        </View>
      ) : (
        <>
          <Field label="種別">
            <Pills
              scroll={false}
              options={Object.entries(TRANSFER_CHANNEL_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              value={channel}
              onChange={setChannel}
            />
          </Field>
          {channel === "CARD_PAYMENT" && (
            <SelectField
              label="カード"
              value={cardId}
              placeholder="カード未紐付け"
              options={cards.map((c) => ({ value: c.id, label: c.name }))}
              onChange={setCardId}
            />
          )}
          <Button small label="登録する" onPress={() => onRegister(channel, cardId)} />
        </>
      )}

      <Text style={s.sheetSection}>削除</Text>
      <Button small variant="danger" label="この明細を削除" onPress={onDelete} />
    </SheetModal>
  );
}

const s = StyleSheet.create({
  helpToggle: { fontSize: 12, color: "#4f46e5", marginBottom: 8 },
  help: { fontSize: 11, color: "#475569", lineHeight: 17, marginBottom: 6 },
  count: { fontSize: 11, color: "#94a3b8", marginBottom: 6 },
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
