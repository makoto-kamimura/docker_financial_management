import { useEffect, useState } from "react";
import {
  Alert, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import {
  fetchAccounts, fetchLoans, patchLoan, postLoan,
  type Account, type Loan,
} from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number | string) =>
  Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pct = (v: number | string) => `${Number(v).toFixed(2)}%`;

const STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: "返済中",   bg: "#dbeafe", color: "#1d4ed8" },
  completed: { label: "完済",     bg: "#d1fae5", color: "#065f46" },
  default:   { label: "延滞",     bg: "#fee2e2", color: "#991b1b" },
};

const NEW_LOAN_DEFAULT = {
  lenderName: "", amount: "", interestRate: "0",
  borrowedOn: "", repaymentDate: "", note: "",
  loanType: "business" as "business" | "housing",
  linkedAccountCode: "", monthlyPayment: "",
};

export function LoansScreen() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newLoan, setNewLoan] = useState(NEW_LOAN_DEFAULT);
  const [saving, setSaving] = useState(false);

  const [editLoanId, setEditLoanId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ repaymentDate: "", monthlyPayment: "", linkedAccountCode: "" });
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const [ls, accs] = await Promise.all([fetchLoans(), fetchAccounts()]);
      setLoans(ls);
      setAccounts(accs.filter(a => a.category === "EXPENSE"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAddLoan() {
    if (!newLoan.lenderName.trim() || !newLoan.amount || !newLoan.borrowedOn || !newLoan.repaymentDate) {
      Alert.alert("入力エラー", "借入先・借入金額・借入日・支払い完了年月は必須です。");
      return;
    }
    setSaving(true);
    try {
      await postLoan({
        lenderName: newLoan.lenderName.trim(),
        amount: Number(newLoan.amount),
        interestRate: Number(newLoan.interestRate) || 0,
        borrowedOn: newLoan.borrowedOn,
        repaymentDate: newLoan.repaymentDate,
        note: newLoan.note.trim() || undefined,
        loanType: newLoan.loanType,
        linkedAccountCode: newLoan.loanType === "housing" ? (newLoan.linkedAccountCode || undefined) : undefined,
        monthlyPayment: newLoan.loanType === "housing" && newLoan.monthlyPayment
          ? Number(newLoan.monthlyPayment) : undefined,
      });
      setShowAddModal(false);
      setNewLoan(NEW_LOAN_DEFAULT);
      await load();
    } catch (e: unknown) {
      Alert.alert("登録エラー", e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(l: Loan) {
    setEditLoanId(l.id);
    setEditForm({
      repaymentDate: l.repaymentDate.slice(0, 10),
      monthlyPayment: l.monthlyPayment ?? "",
      linkedAccountCode: l.linkedAccount?.code ?? "",
    });
  }

  async function handleSaveEdit() {
    if (!editLoanId) return;
    setEditSaving(true);
    try {
      await patchLoan(editLoanId, {
        repaymentDate: editForm.repaymentDate,
        monthlyPayment: editForm.monthlyPayment ? Number(editForm.monthlyPayment) : null,
        linkedAccountCode: editForm.linkedAccountCode || null,
      });
      setEditLoanId(null);
      await load();
    } catch (e: unknown) {
      Alert.alert("更新エラー", e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setEditSaving(false);
    }
  }

  const totalRemaining = loans.reduce((s, l) => s + Number(l.remainingAmount), 0);

  if (loading) return <LoadingView />;

  return (
    <>
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}

      <View style={s.headerRow}>
        <Text style={s.headerTitle}>借入金一覧</Text>
        <TouchableOpacity onPress={() => setShowAddModal(true)}>
          <Text style={s.addBtn}>+ 借入を追加</Text>
        </TouchableOpacity>
      </View>

      <View style={s.totalCard}>
        <Text style={s.totalLabel}>借入残高合計</Text>
        <Text style={s.totalValue}>{yen(totalRemaining)}</Text>
      </View>

      {loans.length === 0 ? (
        <Text style={s.empty}>登録済みの借入金がありません</Text>
      ) : (
        loans.map(l => {
          const st = STATUS_LABEL[l.status] ?? STATUS_LABEL.active;
          const progress = Number(l.amount) > 0
            ? Math.max(0, Math.min(1, 1 - Number(l.remainingAmount) / Number(l.amount)))
            : 0;
          return (
            <View key={l.id} style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.lenderName}>{l.lenderName}</Text>
                <View style={s.badgeRow}>
                  <View style={[s.badge, { backgroundColor: st.bg }]}>
                    <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                  </View>
                  {l.loanType === "housing" && (
                    <View style={[s.badge, { backgroundColor: "#eef2ff" }]}>
                      <Text style={[s.badgeText, { color: "#4f46e5" }]}>🏠 住宅ローン</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={s.row}>
                <View style={s.col}>
                  <Text style={s.colLabel}>借入額</Text>
                  <Text style={s.colValue}>{yen(l.amount)}</Text>
                </View>
                <View style={s.col}>
                  <Text style={s.colLabel}>残高</Text>
                  <Text style={[s.colValue, { color: "#dc2626" }]}>{yen(l.remainingAmount)}</Text>
                </View>
                <View style={s.col}>
                  <Text style={s.colLabel}>金利</Text>
                  <Text style={s.colValue}>{pct(l.interestRate)}</Text>
                </View>
              </View>

              <View style={s.progressBg}>
                <View style={[s.progressFill, { width: `${progress * 100}%` as unknown as number }]} />
              </View>
              <Text style={s.progressLabel}>{(progress * 100).toFixed(0)}% 返済済み</Text>

              <Text style={s.dates}>
                借入: {l.borrowedOn.slice(0, 10)} → 支払い完了年月: {l.repaymentDate.slice(0, 7)}
              </Text>

              {l.loanType === "housing" && (
                <View style={s.housingInfo}>
                  {l.monthlyPayment && (
                    <Text style={s.housingInfoTxt}>月々の返済額: {yen(l.monthlyPayment)}</Text>
                  )}
                  {l.linkedAccount && (
                    <Text style={s.housingInfoTxt}>
                      予算連携先: {l.linkedAccount.code} {l.linkedAccount.name}（自動加算）
                    </Text>
                  )}
                </View>
              )}

              <TouchableOpacity style={s.editBtn} onPress={() => openEdit(l)}>
                <Text style={s.editBtnTxt}>編集</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}

      <View style={{ height: 24 }} />
    </ScrollView>

    {/* 借入追加モーダル */}
    <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
      <Pressable style={s.modalOverlay} onPress={() => setShowAddModal(false)}>
        <ScrollView style={s.modalSheet} onStartShouldSetResponder={() => true}>
          <Text style={s.modalTitle}>借入追加</Text>

          <Text style={s.modalLabel}>借入先 *</Text>
          <TextInput style={s.modalInput} value={newLoan.lenderName}
            onChangeText={t => setNewLoan(f => ({ ...f, lenderName: t }))} />

          <Text style={s.modalLabel}>借入金額（円） *</Text>
          <TextInput style={s.modalInput} keyboardType="number-pad" value={newLoan.amount}
            onChangeText={t => setNewLoan(f => ({ ...f, amount: t.replace(/[^0-9]/g, "") }))} />

          <Text style={s.modalLabel}>年利率（例: 0.03）</Text>
          <TextInput style={s.modalInput} keyboardType="decimal-pad" value={newLoan.interestRate}
            onChangeText={t => setNewLoan(f => ({ ...f, interestRate: t.replace(/[^0-9.]/g, "") }))} />

          <Text style={s.modalLabel}>借入日（YYYY-MM-DD） *</Text>
          <TextInput style={s.modalInput} value={newLoan.borrowedOn} placeholder="2026-04-01"
            placeholderTextColor="#cbd5e1"
            onChangeText={t => setNewLoan(f => ({ ...f, borrowedOn: t }))} />

          <Text style={s.modalLabel}>支払い完了年月（YYYY-MM-DD） *</Text>
          <TextInput style={s.modalInput} value={newLoan.repaymentDate} placeholder="2050-03-31"
            placeholderTextColor="#cbd5e1"
            onChangeText={t => setNewLoan(f => ({ ...f, repaymentDate: t }))} />

          <Text style={s.modalLabel}>借入種別</Text>
          <View style={s.typeRow}>
            {(["business", "housing"] as const).map(t => (
              <TouchableOpacity
                key={t}
                style={[s.typeChip, newLoan.loanType === t && s.typeChipActive]}
                onPress={() => setNewLoan(f => ({ ...f, loanType: t }))}
              >
                <Text style={[s.typeChipTxt, newLoan.loanType === t && s.typeChipTxtActive]}>
                  {t === "business" ? "事業性借入" : "住宅ローン"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {newLoan.loanType === "housing" && (
            <>
              <Text style={s.modalLabel}>予算連携先科目（例: 家賃）</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 4 }}>
                {accounts.map(a => (
                  <TouchableOpacity
                    key={a.code}
                    style={[s.typeChip, newLoan.linkedAccountCode === a.code && s.typeChipActive]}
                    onPress={() => setNewLoan(f => ({ ...f, linkedAccountCode: a.code }))}
                  >
                    <Text style={[s.typeChipTxt, newLoan.linkedAccountCode === a.code && s.typeChipTxtActive]}>
                      {a.code} {a.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.modalLabel}>月々の返済額（円）</Text>
              <TextInput style={s.modalInput} keyboardType="number-pad" value={newLoan.monthlyPayment}
                onChangeText={t => setNewLoan(f => ({ ...f, monthlyPayment: t.replace(/[^0-9]/g, "") }))} />
              <Text style={s.modalHint}>支払い完了年月まで、連携先科目の予算に毎月自動加算されます。</Text>
            </>
          )}

          <Text style={s.modalLabel}>備考</Text>
          <TextInput style={s.modalInput} value={newLoan.note}
            onChangeText={t => setNewLoan(f => ({ ...f, note: t }))} />

          <View style={s.modalBtnRow}>
            <TouchableOpacity style={s.modalCancelBtn} onPress={() => setShowAddModal(false)}>
              <Text style={s.modalCancelTxt}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalSaveBtn} onPress={handleAddLoan} disabled={saving}>
              <Text style={s.modalSaveTxt}>{saving ? "保存中…" : "登録"}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Pressable>
    </Modal>

    {/* 借入編集モーダル（支払い完了年月・月々の返済額・予算連携先） */}
    <Modal visible={editLoanId !== null} transparent animationType="slide" onRequestClose={() => setEditLoanId(null)}>
      <Pressable style={s.modalOverlay} onPress={() => setEditLoanId(null)}>
        <Pressable style={s.modalSheet} onPress={e => e.stopPropagation()}>
          <Text style={s.modalTitle}>借入条件の編集</Text>

          <Text style={s.modalLabel}>支払い完了年月（YYYY-MM-DD） *</Text>
          <TextInput style={s.modalInput} value={editForm.repaymentDate}
            onChangeText={t => setEditForm(f => ({ ...f, repaymentDate: t }))} />

          <Text style={s.modalLabel}>予算連携先科目（例: 家賃）</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 4 }}>
            <TouchableOpacity
              style={[s.typeChip, editForm.linkedAccountCode === "" && s.typeChipActive]}
              onPress={() => setEditForm(f => ({ ...f, linkedAccountCode: "" }))}
            >
              <Text style={[s.typeChipTxt, editForm.linkedAccountCode === "" && s.typeChipTxtActive]}>連携なし</Text>
            </TouchableOpacity>
            {accounts.map(a => (
              <TouchableOpacity
                key={a.code}
                style={[s.typeChip, editForm.linkedAccountCode === a.code && s.typeChipActive]}
                onPress={() => setEditForm(f => ({ ...f, linkedAccountCode: a.code }))}
              >
                <Text style={[s.typeChipTxt, editForm.linkedAccountCode === a.code && s.typeChipTxtActive]}>
                  {a.code} {a.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.modalLabel}>月々の返済額（円）</Text>
          <TextInput style={s.modalInput} keyboardType="number-pad" value={editForm.monthlyPayment}
            onChangeText={t => setEditForm(f => ({ ...f, monthlyPayment: t.replace(/[^0-9]/g, "") }))} />
          <Text style={s.modalHint}>連携先科目を設定すると、支払い完了年月まで予算に毎月自動加算されます。</Text>

          <View style={s.modalBtnRow}>
            <TouchableOpacity style={s.modalCancelBtn} onPress={() => setEditLoanId(null)}>
              <Text style={s.modalCancelTxt}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalSaveBtn} onPress={handleSaveEdit} disabled={editSaving}>
              <Text style={s.modalSaveTxt}>{editSaving ? "保存中…" : "保存"}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center", marginBottom: 12 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  addBtn: { fontSize: 13, fontWeight: "700", color: "#4f46e5" },
  totalCard: {
    backgroundColor: "#dc2626", borderRadius: 14, padding: 18, marginBottom: 16, alignItems: "center",
  },
  totalLabel: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginBottom: 4 },
  totalValue: { color: "#fff", fontSize: 24, fontWeight: "700" },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  badgeRow: { flexDirection: "row", gap: 6 },
  lenderName: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  row: { flexDirection: "row", marginBottom: 12 },
  col: { flex: 1 },
  colLabel: { fontSize: 11, color: "#94a3b8", marginBottom: 2 },
  colValue: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  progressBg: { height: 6, backgroundColor: "#f1f5f9", borderRadius: 3, marginBottom: 4 },
  progressFill: { height: 6, backgroundColor: "#4f46e5", borderRadius: 3 },
  progressLabel: { fontSize: 11, color: "#64748b", marginBottom: 8 },
  dates: { fontSize: 11, color: "#94a3b8" },
  housingInfo: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  housingInfoTxt: { fontSize: 11, color: "#4f46e5" },
  editBtn: { alignSelf: "flex-end", marginTop: 8 },
  editBtnTxt: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, maxHeight: "88%" },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#1e293b", marginBottom: 14 },
  modalLabel: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 8 },
  modalInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: "#1e293b" },
  modalHint: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 8 },
  modalCancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  modalCancelTxt: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  modalSaveBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#4f46e5" },
  modalSaveTxt: { fontSize: 13, fontWeight: "700", color: "#fff" },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 6 },
  typeChipActive: { backgroundColor: "#4f46e5" },
  typeChipTxt: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  typeChipTxtActive: { color: "#fff" },
});
