// 実績の画面の「履歴」の出どころ「明細分け」（web 版の components/entry/ShopOrdersPanel.tsx と同じ）。
// 明細管理で登録した明細分け（Amazon など）に取り込んだ注文を、請求ごとに並べる。
// 商品ごとに科目・事業利用を付け（商品名で学習する）、カード・銀行の明細に紐付ける。
// 自動で紐付かなかった請求は「明細を選ぶ」で、金額と日付の近い候補から手で紐付ける。
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  autoLinkShopOrders,
  deleteShopOrder,
  fetchShopOrderCandidates,
  fetchShopOrders,
  linkShopOrder,
  patchShopOrderItem,
  unlinkShopOrder,
  type Account,
  type ShopOrder,
  type ShopOrderCandidate,
  type ShopOrderItem,
  type ShopOrderStatus,
  type ViewMode,
} from "../api";
import { yen } from "../format";
import { displayName } from "../shared/display-name";
import { SHOP_HELP } from "../shared/help-texts";
import { BusinessRatioControl } from "./BusinessUseControls";
import { CategoryPickerModal } from "./CategoryPickerModal";
import { Button, EmptyText, Lead, Notice, Pills, SheetModal } from "./ui";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: { value: ShopOrderStatus; label: string }[] = [
  { value: "all", label: "全件" },
  { value: "unlinked", label: "未紐付け" },
  { value: "uncategorized", label: "科目なしあり" },
];
const fmtYmd = (ymd: string) => ymd.replaceAll("-", "/");

export function ShopOrdersList({
  shopAccountId,
  categoryAccounts,
  viewMode,
}: {
  /** 明細分け（null はすべて） */
  shopAccountId: number | null;
  categoryAccounts: Account[];
  viewMode: ViewMode;
}) {
  const [status, setStatus] = useState<ShopOrderStatus>("all");
  const [orders, setOrders] = useState<ShopOrder[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picking, setPicking] = useState<ShopOrderItem | null>(null);
  const [linking, setLinking] = useState<ShopOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchShopOrders({ shopAccountId, status, limit, offset: 0 });
      setOrders(res.data);
      setTotal(res.total);
    } catch (e) {
      setOrders([]);
      setMsg({ ok: false, text: e instanceof Error ? e.message : "注文の取得に失敗しました" });
    }
  }, [shopAccountId, status, limit]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存に失敗しました" });
    }
  }

  async function autoLink() {
    setBusy(true);
    try {
      const linked = await autoLinkShopOrders(shopAccountId);
      setMsg({
        ok: true,
        text:
          linked > 0
            ? `${linked} 件の注文を明細に紐付けました。`
            : "自動で紐付けられる注文はありませんでした（金額と日付が合い、相手が 1 つに決まるものだけを紐付けます）。",
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "自動の紐付けに失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  function confirmUnlink(o: ShopOrder) {
    Alert.alert(
      "紐付けを外す",
      `注文 ${o.orderNo} の紐付けを外しますか？明細は未割り当てに戻ります。`,
      [
        { text: "キャンセル", style: "cancel" },
        { text: "外す", style: "destructive", onPress: () => run(() => unlinkShopOrder(o.id)) },
      ],
    );
  }

  function confirmDelete(o: ShopOrder) {
    Alert.alert(
      "注文を削除",
      `注文 ${o.orderNo} を削除しますか？商品も一緒に消えます。${o.entry ? "紐付けた明細は未割り当てに戻ります。" : ""}`,
      [
        { text: "キャンセル", style: "cancel" },
        { text: "削除", style: "destructive", onPress: () => run(() => deleteShopOrder(o.id)) },
      ],
    );
  }

  const categoryLabel = (i: ShopOrderItem) => {
    if (!i.categoryAccount) return "科目を選択";
    const a = categoryAccounts.find((x) => x.id === i.categoryAccount!.id);
    return `${i.categoryAccount.code} ${a ? displayName(a, viewMode) : i.categoryAccount.name}`;
  };

  return (
    <View>
      <Lead>{SHOP_HELP.history}</Lead>
      <Pills scroll={false} options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      <View style={s.toolbar}>
        <Text style={s.count}>{orders ? `${total} 件` : ""}</Text>
        <TouchableOpacity onPress={autoLink} disabled={busy}>
          <Text style={[s.link, busy && s.disabled]}>自動で紐付ける</Text>
        </TouchableOpacity>
      </View>
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}

      {orders === null ? (
        <ActivityIndicator color="#4f46e5" style={{ marginTop: 16 }} />
      ) : orders.length === 0 ? (
        <EmptyText>
          {status !== "all"
            ? "この条件に一致する注文はありません"
            : "注文がありません（注文の CSV の取り込みは web 版で行います）"}
        </EmptyText>
      ) : (
        orders.map((o) => (
          <View key={o.id} style={s.card}>
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>
                  {fmtYmd(o.date)}・{o.shopAccount.name}
                  {o.sellerName ? `・${o.sellerName}` : ""}
                </Text>
                <Text style={s.meta}>注文番号 {o.orderNo}</Text>
              </View>
              <Text style={s.amount}>{yen(o.amount)}</Text>
            </View>
            {o.entry ? (
              <Text style={s.meta}>
                紐付け先: {o.entry.sourceName}・{o.entry.date ? fmtYmd(o.entry.date) : ""}・
                {yen(Math.abs(o.entry.amount))}（{o.linkedBy === "AUTO" ? "自動" : "手動"}）
                {Math.abs(o.entry.amount) !== o.amount ? "・差額は商品の金額の割合で割り振り" : ""}
              </Text>
            ) : (
              <Text style={s.warn}>カード・銀行の明細に紐付いていません</Text>
            )}
            {o.items.map((i) => (
              <View key={i.id} style={s.item}>
                <View style={s.itemHead}>
                  <Text style={s.itemName} numberOfLines={2}>
                    {i.name}
                    {i.quantity > 1 ? ` ×${i.quantity}` : ""}
                  </Text>
                  <Text style={s.itemAmount}>{yen(i.allocatedAmount ?? i.amount)}</Text>
                </View>
                <TouchableOpacity
                  style={[s.chip, i.categoryAccount ? s.chipSet : s.chipEmpty]}
                  onPress={() => setPicking(i)}
                >
                  <Text style={[s.chipText, i.categoryAccount && s.chipTextSet]} numberOfLines={1}>
                    {categoryLabel(i)}
                  </Text>
                </TouchableOpacity>
                {viewMode === "sole" && (
                  <BusinessRatioControl
                    businessUse={i.businessUse}
                    businessRatio={i.businessRatio}
                    onChange={(c) => run(() => patchShopOrderItem(i.id, c))}
                  />
                )}
              </View>
            ))}
            <View style={s.actions}>
              {o.entry ? (
                <TouchableOpacity onPress={() => confirmUnlink(o)}>
                  <Text style={s.muted}>紐付けを外す</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setLinking(o)}>
                  <Text style={s.link}>明細を選ぶ</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => confirmDelete(o)}>
                <Text style={s.danger}>削除</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
      {orders && orders.length < total && (
        <Button
          label="もっと見る"
          variant="secondary"
          onPress={() => setLimit((l) => l + PAGE_SIZE)}
        />
      )}

      <CategoryPickerModal
        visible={picking !== null}
        accounts={categoryAccounts}
        description={picking?.name}
        currentId={picking?.categoryAccountId ?? null}
        onSelect={(id) => {
          const item = picking;
          setPicking(null);
          if (item) run(() => patchShopOrderItem(item.id, { categoryAccountId: id }));
        }}
        onClose={() => setPicking(null)}
      />
      <LinkSheet
        order={linking}
        onClose={() => setLinking(null)}
        onLinked={() => {
          setLinking(null);
          load();
        }}
      />
    </View>
  );
}

// 手での紐付け。請求日の前後 14 日の出金の明細を、金額の差の小さい順に出す
function LinkSheet({
  order,
  onClose,
  onLinked,
}: {
  order: ShopOrder | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [candidates, setCandidates] = useState<ShopOrderCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCandidates(null);
    setError(null);
    if (!order) return;
    fetchShopOrderCandidates(order.id)
      .then(setCandidates)
      .catch((e) => {
        setCandidates([]);
        setError(e instanceof Error ? e.message : "候補の取得に失敗しました");
      });
  }, [order]);

  async function link(entryId: number) {
    if (!order) return;
    setError(null);
    try {
      await linkShopOrder(order.id, entryId);
      onLinked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "紐付けに失敗しました");
    }
  }

  return (
    <SheetModal
      visible={order !== null}
      title="明細を選ぶ"
      subtitle={
        order
          ? `${order.shopAccount.name}・注文番号 ${order.orderNo}・${fmtYmd(order.date)}・請求額 ${yen(order.amount)}。${SHOP_HELP.candidates}`
          : undefined
      }
      onClose={onClose}
    >
      {error && <Notice tone="error">{error}</Notice>}
      {candidates === null ? (
        <ActivityIndicator color="#4f46e5" />
      ) : candidates.length === 0 ? (
        <EmptyText>
          紐付けられる明細が見つかりません（請求日の前後 14
          日の、銀行・カードの出金の明細から探します）。
        </EmptyText>
      ) : (
        candidates.map((c) => (
          <View key={c.id} style={s.candidate}>
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>
                {fmtYmd(c.date)}・{c.sourceName}
              </Text>
              <Text style={s.meta} numberOfLines={2}>
                {c.description}
              </Text>
              <Text style={c.amountGap === 0 ? s.ok : s.warn}>
                {yen(Math.abs(c.amount))}・
                {c.amountGap === 0
                  ? "金額一致"
                  : `差 ${c.amountGap > 0 ? "+" : ""}${yen(c.amountGap)}`}
                ・
                {c.dayGap === 0
                  ? "同じ日"
                  : `${Math.abs(c.dayGap)} 日${c.dayGap > 0 ? "後" : "前"}`}
                {c.keywordMatch ? "・摘要一致" : ""}
              </Text>
              {c.categoryAccount && (
                <Text style={s.muted}>
                  いまの科目: {c.categoryAccount.name}（紐付けると外れます）
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => link(c.id)}>
              <Text style={s.link}>紐付ける</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </SheetModal>
  );
}

const s = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 8,
  },
  count: { fontSize: 12, color: "#64748b" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    marginBottom: 10,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  amount: { fontSize: 14, fontWeight: "700", color: "#e11d48" },
  meta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  warn: { fontSize: 12, color: "#b45309", marginTop: 2 },
  ok: { fontSize: 12, color: "#059669", marginTop: 2 },
  item: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 8, gap: 6, marginTop: 6 },
  itemHead: { flexDirection: "row", gap: 8 },
  itemName: { flex: 1, fontSize: 13, color: "#1e293b" },
  itemAmount: { fontSize: 13, color: "#334155" },
  chip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipEmpty: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" },
  chipSet: { borderColor: "#c7d2fe", backgroundColor: "#eef2ff" },
  chipText: { fontSize: 12, color: "#92400e" },
  chipTextSet: { color: "#4338ca" },
  actions: { flexDirection: "row", gap: 16, marginTop: 8 },
  link: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 13, color: "#dc2626", fontWeight: "600" },
  muted: { fontSize: 12, color: "#94a3b8" },
  disabled: { color: "#cbd5e1" },
  candidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
});
