import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Line, Polyline, Circle, Text as SvgText } from "react-native-svg";
import {
  deletePersonalAsset, fetchAssets, fetchPersonalAssets, patchPersonalAsset, postPersonalAsset,
  type AssetAccount, type PersonalAsset, type PersonalAssetCategory,
} from "../api";
import { LoadingView } from "../components/LoadingView";

const PA_CATEGORY_LABEL: Record<PersonalAssetCategory, string> = {
  LAND: "土地", BUILDING: "建物", VEHICLE: "車", GOLD: "金", OTHER: "その他",
};
const PA_CATEGORIES: PersonalAssetCategory[] = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"];

const yen = (v: number) =>
  v >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

/** そのyearで最後のmonthの残高（Web の latestBalance と同じロジック） */
function latestBalance(balances: AssetAccount["balances"], year: number): number {
  const ys = balances.filter((b) => b.fiscalYear === year);
  if (!ys.length) return 0;
  return ys.reduce((best, b) => (b.month > best.month ? b : best)).amount;
}

type TrendPoint = { year: number; asset: number; liab: number; net: number };

function leafOf(accounts: AssetAccount[], cat: "ASSET" | "LIABILITY"): AssetAccount[] {
  return accounts.filter(
    (a) => a.category === cat && !accounts.some((c) => c.parentId === a.id),
  );
}

function buildTrend(accounts: AssetAccount[], years: number[]): TrendPoint[] {
  const assetLeaves = leafOf(accounts, "ASSET");
  const liabLeaves = leafOf(accounts, "LIABILITY");
  return years.map((year) => {
    const asset = assetLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    const liab = liabLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    return { year, asset, liab, net: asset - liab };
  });
}

// ── SVG折れ線グラフ ────────────────────────────────────────────────────
const CHART_W = 320;
const CHART_H = 140;
const PAD = { top: 10, right: 10, bottom: 28, left: 50 };

function scalePoints(values: number[], min: number, max: number, count: number): string {
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = PAD.left + (i / Math.max(count - 1, 1)) * (CHART_W - PAD.left - PAD.right);
      const y = PAD.top + (1 - (v - min) / range) * (CHART_H - PAD.top - PAD.bottom);
      return `${x},${y}`;
    })
    .join(" ");
}

function AssetTrendChart({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) return null;
  const allVals = trend.flatMap((t) => [t.asset, t.liab, t.net]);
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const count = trend.length;

  const assets = trend.map((t) => t.asset);
  const liabs = trend.map((t) => t.liab);
  const nets = trend.map((t) => t.net);

  const axisY = PAD.top + (CHART_H - PAD.top - PAD.bottom);
  const axisX = PAD.left;

  return (
    <Svg width={CHART_W} height={CHART_H}>
      {/* 軸 */}
      <Line x1={axisX} y1={PAD.top} x2={axisX} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />
      <Line x1={axisX} y1={axisY} x2={CHART_W - PAD.right} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />

      {/* 折れ線 */}
      <Polyline
        points={scalePoints(assets, minVal, maxVal, count)}
        fill="none"
        stroke="#10b981"
        strokeWidth={2}
      />
      <Polyline
        points={scalePoints(liabs, minVal, maxVal, count)}
        fill="none"
        stroke="#f43f5e"
        strokeWidth={2}
      />
      <Polyline
        points={scalePoints(nets, minVal, maxVal, count)}
        fill="none"
        stroke="#6366f1"
        strokeWidth={2.5}
      />

      {/* X軸ラベル（年） */}
      {trend.map((t, i) => {
        const x = PAD.left + (i / Math.max(count - 1, 1)) * (CHART_W - PAD.left - PAD.right);
        return (
          <SvgText
            key={t.year}
            x={x}
            y={CHART_H - 4}
            fontSize={9}
            textAnchor="middle"
            fill="#94a3b8"
          >
            {t.year}
          </SvgText>
        );
      })}

      {/* 純資産の最終値ドット */}
      {(() => {
        const last = trend[trend.length - 1];
        const x = CHART_W - PAD.right;
        const range = maxVal - minVal || 1;
        const y = PAD.top + (1 - (last.net - minVal) / range) * (CHART_H - PAD.top - PAD.bottom);
        return <Circle cx={x} cy={y} r={3} fill="#6366f1" />;
      })()}
    </Svg>
  );
}

// ── メイン画面 ─────────────────────────────────────────────────────────
export function AssetsScreen() {
  const [accounts, setAccounts] = useState<AssetAccount[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [personalAssets, setPersonalAssets] = useState<PersonalAsset[]>([]);
  const [assetModalAccount, setAssetModalAccount] = useState<AssetAccount | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "", category: "LAND" as PersonalAssetCategory,
    acquisitionCost: "", currentValue: "", note: "",
  });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  function linkedAssetOf(accountId: number): PersonalAsset | undefined {
    return personalAssets.find((pa) => pa.linkedAccountId === accountId);
  }

  function openAssetModalForAccount(account: AssetAccount) {
    const existing = linkedAssetOf(account.id);
    if (existing) {
      setEditingAssetId(existing.id);
      setForm({
        name: existing.name,
        category: existing.category,
        acquisitionCost: existing.acquisitionCost ?? "",
        currentValue: existing.currentValue,
        note: existing.note ?? "",
      });
    } else {
      setEditingAssetId(null);
      setForm({ name: "", category: "LAND", acquisitionCost: "", currentValue: "", note: "" });
    }
    setAssetModalAccount(account);
  }

  function closeAssetModal() {
    setAssetModalAccount(null);
    setEditingAssetId(null);
  }

  async function load() {
    setError(null);
    try {
      // year パラメータなし → 全年分一括取得（Web と同じ）
      const [data, pa] = await Promise.all([fetchAssets(), fetchPersonalAssets()]);
      setAccounts(data.accounts);
      setYears(data.years);
      if (data.years.length > 0) {
        setSelectedYear((prev) => prev ?? data.years[data.years.length - 1]);
      }
      setPersonalAssets(pa);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleSaveAsset() {
    if (!assetModalAccount) return;
    if (!form.name.trim() || !form.currentValue.trim()) {
      Alert.alert("入力エラー", "資産名と現在評価額を入力してください。");
      return;
    }
    setSaving(true);
    try {
      if (editingAssetId) {
        await patchPersonalAsset(editingAssetId, {
          name: form.name.trim(),
          category: form.category,
          acquisitionCost: form.acquisitionCost ? Number(form.acquisitionCost) : null,
          currentValue: Number(form.currentValue),
          note: form.note.trim() || null,
        });
      } else {
        await postPersonalAsset({
          name: form.name.trim(),
          category: form.category,
          acquisitionCost: form.acquisitionCost ? Number(form.acquisitionCost) : undefined,
          currentValue: Number(form.currentValue),
          note: form.note.trim() || undefined,
          linkedAccountId: assetModalAccount.id,
        });
      }
      closeAssetModal();
      setForm({ name: "", category: "LAND", acquisitionCost: "", currentValue: "", note: "" });
      await load();
    } catch (e: unknown) {
      Alert.alert("登録エラー", e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function handleUnlinkAsset() {
    if (!editingAssetId) return;
    const id = editingAssetId;
    Alert.alert("登録解除確認", "この実物資産の登録を解除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "解除", style: "destructive",
        onPress: async () => {
          await deletePersonalAsset(id);
          closeAssetModal();
          await load();
        },
      },
    ]);
  }

  async function handleUpdateValue(id: number) {
    try {
      await patchPersonalAsset(id, { currentValue: Number(editValue) || 0 });
      setEditId(null);
      await load();
    } catch (e: unknown) {
      Alert.alert("更新エラー", e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  function handleDeleteAsset(id: number) {
    Alert.alert("削除確認", "この資産を削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除", style: "destructive",
        onPress: async () => { await deletePersonalAsset(id); await load(); },
      },
    ]);
  }

  const year = selectedYear ?? years.at(-1) ?? new Date().getFullYear();
  const topAssets = accounts.filter((a) => a.category === "ASSET" && a.parentId === null);
  const topLiabs = accounts.filter((a) => a.category === "LIABILITY" && a.parentId === null);
  const totalAsset = leafOf(accounts, "ASSET").reduce((s, a) => s + latestBalance(a.balances, year), 0);
  const totalLiab = leafOf(accounts, "LIABILITY").reduce((s, a) => s + latestBalance(a.balances, year), 0);
  const netWorth = totalAsset - totalLiab;
  const trend = buildTrend(accounts, years);

  const childrenOf = (parentId: number) => accounts.filter((a) => a.parentId === parentId);

  return (
    <>
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.title}>資産管理</Text>

      {loading ? (
        <LoadingView />
      ) : error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : (
        <>
          {/* 実物資産（土地・建物・車・金など） */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>実物資産（土地・建物・車・金など）</Text>
            {personalAssets.length === 0 ? (
              <Text style={s.emptyText}>登録済みの実物資産がありません。下の「負債の部」の項目をタップして登録できます。</Text>
            ) : (
              <>
                {personalAssets.map((a) => (
                  <View key={a.id} style={s.row}>
                    <View style={s.rowLeft}>
                      <Text style={s.rowCode}>{PA_CATEGORY_LABEL[a.category]}</Text>
                      <Text style={s.rowName}>{a.name}</Text>
                    </View>
                    {editId === a.id ? (
                      <View style={s.paEditRow}>
                        <TextInput
                          autoFocus
                          keyboardType="number-pad"
                          value={editValue}
                          onChangeText={setEditValue}
                          style={s.paEditInput}
                        />
                        <TouchableOpacity onPress={() => handleUpdateValue(a.id)}>
                          <Text style={s.paCheck}>✓</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={s.paEditRow}>
                        <TouchableOpacity onPress={() => { setEditId(a.id); setEditValue(String(a.currentValue)); }}>
                          <Text style={s.balance}>{yen(Number(a.currentValue))}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteAsset(a.id)}>
                          <Text style={s.paDelete}>削除</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>実物資産合計</Text>
                  <Text style={s.totalValue}>
                    {yen(personalAssets.reduce((sum, a) => sum + Number(a.currentValue), 0))}
                  </Text>
                </View>
              </>
            )}
          </View>

          {accounts.length === 0 ? (
            <View style={s.emptyBox}><Text style={s.emptyText}>資産データがありません。</Text></View>
          ) : (
            <>
          {/* 年選択 */}
          {years.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.yearRow}>
              {years.slice(-10).map((y) => (
                <TouchableOpacity
                  key={y}
                  style={[s.yearChip, selectedYear === y && s.yearChipActive]}
                  onPress={() => setSelectedYear(y)}
                >
                  <Text style={[s.yearChipText, selectedYear === y && s.yearChipTextActive]}>{y}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* KPI カード */}
          <View style={s.kpiRow}>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>資産合計</Text>
              <Text style={[s.kpiValue, { color: "#10b981" }]}>{yen(totalAsset)}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>負債合計</Text>
              <Text style={[s.kpiValue, { color: "#f43f5e" }]}>{yen(totalLiab)}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>純資産</Text>
              <Text style={[s.kpiValue, { color: netWorth >= 0 ? "#6366f1" : "#dc2626" }]}>
                {yen(netWorth)}
              </Text>
            </View>
          </View>

          {/* 純資産推移グラフ */}
          {trend.length >= 2 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>純資産推移（万円）</Text>
              <AssetTrendChart trend={trend} />
              <View style={s.legend}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#10b981" }]} />
                  <Text style={s.legendText}>資産合計</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#f43f5e" }]} />
                  <Text style={s.legendText}>負債合計</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#6366f1" }]} />
                  <Text style={s.legendText}>純資産</Text>
                </View>
              </View>
            </View>
          )}

          {/* 資産の部 */}
          {topAssets.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>資産の部</Text>
              {topAssets.map((a) => (
                <View key={a.id}>
                  <View style={[s.row, s.rowParent]}>
                    <View style={s.rowLeft}>
                      <Text style={s.rowCode}>{a.code}</Text>
                      <Text style={s.rowName}>{a.name}</Text>
                    </View>
                    <Text style={[s.balance, { color: "#059669" }]}>
                      {yen(latestBalance(a.balances, year))}
                    </Text>
                  </View>
                  {childrenOf(a.id).map((c) => (
                    <View key={c.id} style={[s.row, s.rowChild]}>
                      <View style={s.rowLeft}>
                        <Text style={s.rowCode}>{c.code}</Text>
                        <Text style={[s.rowName, { color: "#64748b", fontSize: 13 }]}>{c.name}</Text>
                      </View>
                      <Text style={[s.balance, { fontSize: 13, color: "#374151" }]}>
                        {yen(latestBalance(c.balances, year))}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>資産合計</Text>
                <Text style={[s.totalValue, { color: "#059669" }]}>{yen(totalAsset)}</Text>
              </View>
            </View>
          )}

          {/* 負債の部（項目をタップすると実物資産を登録・編集できます） */}
          {topLiabs.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>負債の部</Text>
              {topLiabs.map((a) => {
                const isLeaf = !accounts.some((c) => c.parentId === a.id);
                const linked = linkedAssetOf(a.id);
                return (
                  <View key={a.id}>
                    <TouchableOpacity
                      disabled={!isLeaf}
                      onPress={() => openAssetModalForAccount(a)}
                      style={[s.row, s.rowParent]}
                    >
                      <View style={s.rowLeft}>
                        <Text style={s.rowCode}>{a.code}</Text>
                        <Text style={s.rowName}>{a.name}</Text>
                        {isLeaf && (
                          <Text style={s.liabAssetHint}>
                            {linked ? `🏠 ${linked.name}` : "タップして実物資産を登録"}
                          </Text>
                        )}
                      </View>
                      <Text style={[s.balance, { color: "#e11d48" }]}>
                        {yen(latestBalance(a.balances, year))}
                      </Text>
                    </TouchableOpacity>
                    {childrenOf(a.id).map((c) => {
                      const cLinked = linkedAssetOf(c.id);
                      return (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => openAssetModalForAccount(c)}
                          style={[s.row, s.rowChild]}
                        >
                          <View style={s.rowLeft}>
                            <Text style={s.rowCode}>{c.code}</Text>
                            <Text style={[s.rowName, { color: "#64748b", fontSize: 13 }]}>{c.name}</Text>
                            <Text style={s.liabAssetHint}>
                              {cLinked ? `🏠 ${cLinked.name}` : "タップして実物資産を登録"}
                            </Text>
                          </View>
                          <Text style={[s.balance, { fontSize: 13, color: "#374151" }]}>
                            {yen(latestBalance(c.balances, year))}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>負債合計</Text>
                <Text style={[s.totalValue, { color: "#e11d48" }]}>{yen(totalLiab)}</Text>
              </View>
            </View>
          )}

          {/* 純資産 */}
          <View style={[s.section, { marginBottom: 24 }]}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>純資産</Text>
              <Text style={[s.totalValue, { color: netWorth >= 0 ? "#6366f1" : "#dc2626" }]}>
                {yen(netWorth)}
              </Text>
            </View>
          </View>
            </>
          )}
        </>
      )}
    </ScrollView>

    <Modal visible={!!assetModalAccount} transparent animationType="slide" onRequestClose={closeAssetModal}>
      <Pressable style={s.modalOverlay} onPress={closeAssetModal}>
        <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.modalTitle}>
            {editingAssetId ? "実物資産 編集" : "実物資産 登録"}
            {assetModalAccount ? `（${assetModalAccount.name}）` : ""}
          </Text>

          <Text style={s.modalLabel}>資産名 *</Text>
          <TextInput
            style={s.modalInput}
            value={form.name}
            onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
            placeholder="自宅土地"
            placeholderTextColor="#cbd5e1"
          />

          <Text style={s.modalLabel}>種別</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }}>
            {PA_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.paChip, form.category === c && s.paChipActive]}
                onPress={() => setForm((f) => ({ ...f, category: c }))}
              >
                <Text style={[s.paChipTxt, form.category === c && s.paChipTxtActive]}>
                  {PA_CATEGORY_LABEL[c]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.modalLabel}>取得価格（円）</Text>
          <TextInput
            style={s.modalInput}
            value={form.acquisitionCost}
            onChangeText={(t) => setForm((f) => ({ ...f, acquisitionCost: t.replace(/[^0-9]/g, "") }))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor="#cbd5e1"
          />

          <Text style={s.modalLabel}>現在評価額（円） *</Text>
          <TextInput
            style={s.modalInput}
            value={form.currentValue}
            onChangeText={(t) => setForm((f) => ({ ...f, currentValue: t.replace(/[^0-9]/g, "") }))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor="#cbd5e1"
          />

          <Text style={s.modalLabel}>備考</Text>
          <TextInput
            style={s.modalInput}
            value={form.note}
            onChangeText={(t) => setForm((f) => ({ ...f, note: t }))}
            placeholderTextColor="#cbd5e1"
          />

          <View style={s.modalBtnRow}>
            <TouchableOpacity style={s.modalCancelBtn} onPress={closeAssetModal}>
              <Text style={s.modalCancelTxt}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalSaveBtn} onPress={handleSaveAsset} disabled={saving}>
              <Text style={s.modalSaveTxt}>{saving ? "保存中…" : editingAssetId ? "更新" : "登録"}</Text>
            </TouchableOpacity>
          </View>
          {editingAssetId && (
            <TouchableOpacity style={s.modalUnlinkBtn} onPress={handleUnlinkAsset}>
              <Text style={s.modalUnlinkTxt}>この資産の登録を解除する</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: "#0f172a" },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { color: "#dc2626", fontSize: 13 },
  emptyBox: { padding: 32, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },
  yearRow: { flexDirection: "row", marginBottom: 14 },
  yearChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 8 },
  yearChipActive: { backgroundColor: "#4f46e5" },
  yearChipText: { fontSize: 13, color: "#64748b" },
  yearChipTextActive: { color: "#fff", fontWeight: "600" },
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  kpiCard: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2, alignItems: "center" },
  kpiLabel: { fontSize: 10, color: "#64748b", marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 10 },
  legend: { flexDirection: "row", gap: 14, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: "#6b7280" },
  section: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  sectionTitle: { fontSize: 11, fontWeight: "700", color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  rowParent: { backgroundColor: "#f8fafc" },
  rowChild: { paddingLeft: 16 },
  rowLeft: {},
  rowCode: { fontSize: 9, color: "#94a3b8", fontFamily: "monospace" },
  rowName: { fontSize: 14, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  balance: { fontSize: 14, fontWeight: "600" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  totalLabel: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  totalValue: { fontSize: 15, fontWeight: "700" },
  liabAssetHint: { fontSize: 10, color: "#4f46e5", marginTop: 2 },
  paEditRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  paEditInput: { width: 90, textAlign: "right", fontSize: 13, fontWeight: "600", color: "#1e293b", borderWidth: 1, borderColor: "#4f46e5", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  paCheck:     { fontSize: 15, color: "#4f46e5", fontWeight: "700" },
  paDelete:    { fontSize: 11, color: "#f43f5e" },
  paChip:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 6 },
  paChipActive: { backgroundColor: "#4f46e5" },
  paChipTxt:   { fontSize: 12, color: "#64748b", fontWeight: "600" },
  paChipTxtActive: { color: "#fff" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  modalSheet:  { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 36 },
  modalTitle:  { fontSize: 17, fontWeight: "700", color: "#1e293b", marginBottom: 14 },
  modalLabel:  { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 8 },
  modalInput:  { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: "#1e293b" },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalCancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  modalCancelTxt: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  modalSaveBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#4f46e5" },
  modalSaveTxt: { fontSize: 13, fontWeight: "700", color: "#fff" },
  modalUnlinkBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  modalUnlinkTxt: { fontSize: 12, fontWeight: "600", color: "#f43f5e" },
});
