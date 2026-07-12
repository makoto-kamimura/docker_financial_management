import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Props = {
  label: string;
  value: string; // "YYYY-MM" または ""（未設定）
  onChange: (value: string) => void;
  placeholder?: string;
};

// "YYYY-MM" 形式の年月を、カレンダー風のモーダル（年送り＋月グリッド）で選択する入力フィールド。
// キーボードを使わないため、キーボードと入力欄の重なりも発生しない。
export function YearMonthPicker({ label, value, onChange, placeholder = "未設定" }: Props) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const initialYear = value ? Number(value.slice(0, 4)) : now.getFullYear();
  const [year, setYear] = useState(initialYear);

  const selectedYear = value ? Number(value.slice(0, 4)) : null;
  const selectedMonth = value ? Number(value.slice(5, 7)) : null;

  function openPicker() {
    setYear(value ? Number(value.slice(0, 4)) : now.getFullYear());
    setOpen(true);
  }

  function pick(month: number) {
    onChange(`${year}-${String(month).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <View style={s.col}>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity style={s.field} onPress={openPicker}>
        <Text style={value ? s.fieldValue : s.fieldPlaceholder}>
          {value ? `${value.slice(0, 4)}年${Number(value.slice(5, 7))}月` : placeholder}
        </Text>
        <Text style={s.fieldIcon}>📅</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.title}>{label}</Text>

            <View style={s.yearRow}>
              <TouchableOpacity style={s.yearBtn} onPress={() => setYear((y) => y - 1)}>
                <Text style={s.yearBtnTxt}>‹</Text>
              </TouchableOpacity>
              <Text style={s.yearTxt}>{year}年</Text>
              <TouchableOpacity style={s.yearBtn} onPress={() => setYear((y) => y + 1)}>
                <Text style={s.yearBtnTxt}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={s.monthGrid}>
              {MONTHS.map((m) => {
                const active = year === selectedYear && m === selectedMonth;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[s.monthCell, active && s.monthCellActive]}
                    onPress={() => pick(m)}
                  >
                    <Text style={[s.monthTxt, active && s.monthTxtActive]}>{m}月</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.btnRow}>
              {!!value && (
                <TouchableOpacity
                  style={s.clearBtn}
                  onPress={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <Text style={s.clearTxt}>クリア</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.cancelBtn} onPress={() => setOpen(false)}>
                <Text style={s.cancelTxt}>閉じる</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  col:        { flex: 1 },
  label:      { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 8 },
  field:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  fieldValue: { fontSize: 14, color: "#1e293b" },
  fieldPlaceholder: { fontSize: 14, color: "#cbd5e1" },
  fieldIcon:  { fontSize: 12 },
  overlay:    { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: 24 },
  sheet:      { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  title:      { fontSize: 14, fontWeight: "700", color: "#1e293b", marginBottom: 12, textAlign: "center" },
  yearRow:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 12 },
  yearBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  yearBtnTxt: { fontSize: 20, color: "#4f46e5", fontWeight: "700", lineHeight: 24 },
  yearTxt:    { fontSize: 16, fontWeight: "700", color: "#0f172a", minWidth: 72, textAlign: "center" },
  monthGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell:  { width: "22%", flexGrow: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#f8fafc", alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  monthCellActive: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  monthTxt:   { fontSize: 13, color: "#374151", fontWeight: "600" },
  monthTxtActive: { color: "#fff" },
  btnRow:     { flexDirection: "row", gap: 10, marginTop: 16 },
  clearBtn:   { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#fecaca" },
  clearTxt:   { fontSize: 13, fontWeight: "600", color: "#f43f5e" },
  cancelBtn:  { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  cancelTxt:  { fontSize: 13, fontWeight: "600", color: "#64748b" },
});
