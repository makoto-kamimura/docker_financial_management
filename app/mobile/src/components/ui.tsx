// 画面共通の UI 部品。web 版の card / btn-primary / タブ / ページ送りに相当する見た目をそろえる。
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

export const COLORS = {
  primary: "#4f46e5",
  primarySoft: "#eef2ff",
  text: "#1e293b",
  sub: "#64748b",
  muted: "#94a3b8",
  border: "#e2e8f0",
  bg: "#f8fafc",
  danger: "#dc2626",
  success: "#16a34a",
  warn: "#d97706",
};

// ── タブ（web 版のページ内タブと同じ並び・文言で使う）──────────────────
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly (readonly [T, string])[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <View style={s.tabBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {tabs.map(([t, label]) => (
          <TouchableOpacity
            key={t}
            style={[s.tab, value === t && s.tabActive]}
            onPress={() => onChange(t)}
          >
            <Text style={[s.tabText, value === t && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ── 選択肢のピル（月・区分・予測手法など）────────────────────────────
export function Pills<T extends string | number>({
  options,
  value,
  onChange,
  scroll = true,
  disabled,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  scroll?: boolean;
  /** true を返した選択肢は押せない（データの無い月など） */
  disabled?: (v: T) => boolean;
}) {
  const body = options.map((o) => {
    const off = disabled?.(o.value) ?? false;
    return (
      <TouchableOpacity
        key={String(o.value)}
        disabled={off}
        style={[s.pill, value === o.value && s.pillActive, off && s.pillDisabled]}
        onPress={() => onChange(o.value)}
      >
        <Text style={[s.pillText, value === o.value && s.pillTextActive]}>{o.label}</Text>
      </TouchableOpacity>
    );
  });
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>
      {body}
    </ScrollView>
  ) : (
    <View style={[s.pills, s.pillsWrap]}>{body}</View>
  );
}

// ── カード・見出し ────────────────────────────────────────────────────
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle}>{children}</Text>
      {note ? <Text style={s.sectionNote}>{note}</Text> : null}
    </View>
  );
}

// ── ボタン ───────────────────────────────────────────────────────────
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  small,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "link";
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  return (
    <TouchableOpacity
      style={[s.btn, s[`btn_${variant}`], small && s.btnSmall, off && s.btnDisabled, style]}
      onPress={onPress}
      disabled={off}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : COLORS.primary} />
      ) : (
        <Text style={[s.btnText, s[`btnText_${variant}`], small && s.btnTextSmall]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// ── 入力欄 ───────────────────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor="#cbd5e1" {...props} style={[s.input, props.style]} />;
}

// ── お知らせ ─────────────────────────────────────────────────────────
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  return (
    <View style={[s.notice, s[`notice_${tone}`]]}>
      <Text style={[s.noticeText, s[`noticeText_${tone}`]]}>{children}</Text>
    </View>
  );
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <Text style={s.empty}>{children}</Text>;
}

// ── 一覧から 1 件選ぶ入力欄（web 版の <select> に相当）─────────────────
export type SelectOption<T> = { value: T; label: string; sub?: string };

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = "選択してください",
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Field label={label}>
      <TouchableOpacity style={s.select} onPress={() => setOpen(true)}>
        <Text style={[s.selectText, !current && s.selectPlaceholder]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Text style={s.selectCaret}>▾</Text>
      </TouchableOpacity>
      <SheetModal visible={open} title={label} onClose={() => setOpen(false)}>
        {options.length === 0 ? (
          <EmptyText>選択肢がありません</EmptyText>
        ) : (
          options.map((o) => (
            <TouchableOpacity
              key={String(o.value)}
              style={s.option}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.optionText}>{o.label}</Text>
                {o.sub ? <Text style={s.optionSub}>{o.sub}</Text> : null}
              </View>
              {o.value === value && <Text style={s.check}>✓</Text>}
            </TouchableOpacity>
          ))
        )}
      </SheetModal>
    </Field>
  );
}

// ── 下から出るシート ──────────────────────────────────────────────────
export function SheetModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** スクロール領域の外（下端）に固定表示する操作ボタンなど */
  footer?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.sheetTitle}>{title}</Text>
            {subtitle ? (
              <Text style={s.sheetSubtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={onClose} style={s.sheetClose}>
            <Text style={s.sheetCloseText}>閉じる</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={s.sheetBody} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={s.sheetFooter}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

// ── ページ送り（web 版の履歴タブと同じ「前の N 件 / 次の N 件」）──────────
export function Pager({
  offset,
  total,
  pageSize,
  onChange,
}: {
  offset: number;
  total: number;
  pageSize: number;
  onChange: (offset: number) => void;
}) {
  return (
    <View style={s.pager}>
      <Button
        small
        variant="secondary"
        label={`← 前の ${pageSize} 件`}
        disabled={offset === 0}
        onPress={() => onChange(Math.max(0, offset - pageSize))}
      />
      <Text style={s.pagerText}>
        {Math.floor(offset / pageSize) + 1} / {Math.max(1, Math.ceil(total / pageSize))} ページ
      </Text>
      <Button
        small
        variant="secondary"
        label={`次の ${pageSize} 件 →`}
        disabled={offset + pageSize >= total}
        onPress={() => onChange(offset + pageSize)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  tabBar: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: "600", color: COLORS.sub },
  tabTextActive: { color: "#4338ca" },

  pills: { flexDirection: "row", gap: 6, paddingVertical: 4 },
  pillsWrap: { flexWrap: "wrap" },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
  },
  pillActive: { backgroundColor: COLORS.primary },
  pillDisabled: { opacity: 0.35 },
  pillText: { fontSize: 12, fontWeight: "600", color: COLORS.sub },
  pillTextActive: { color: "#fff" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  sectionHead: { marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  sectionNote: { fontSize: 11, color: COLORS.muted, marginTop: 3, lineHeight: 16 },

  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btn_primary: { backgroundColor: COLORS.primary },
  btn_secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: COLORS.border },
  btn_danger: { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  btn_link: { paddingVertical: 6, paddingHorizontal: 4 },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 14, fontWeight: "700" },
  btnText_primary: { color: "#fff" },
  btnText_secondary: { color: "#475569" },
  btnText_danger: { color: COLORS.danger },
  btnText_link: { color: COLORS.primary, fontWeight: "600" },
  btnTextSmall: { fontSize: 12 },

  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 11, color: COLORS.sub, marginBottom: 4, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: "#fff",
  },

  notice: { borderRadius: 8, padding: 10, borderWidth: 1, marginBottom: 10 },
  notice_info: { backgroundColor: "#f1f5f9", borderColor: COLORS.border },
  notice_warn: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  notice_error: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  notice_success: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
  noticeText: { fontSize: 12, lineHeight: 18 },
  noticeText_info: { color: "#475569" },
  noticeText_warn: { color: "#b45309" },
  noticeText_error: { color: COLORS.danger },
  noticeText_success: { color: "#15803d" },

  empty: { textAlign: "center", color: COLORS.muted, fontSize: 13, paddingVertical: 24 },

  select: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  selectText: { flex: 1, fontSize: 14, color: COLORS.text },
  selectPlaceholder: { color: "#cbd5e1" },
  selectCaret: { fontSize: 12, color: COLORS.muted, marginLeft: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  optionText: { fontSize: 14, color: "#334155" },
  optionSub: { fontSize: 10, color: COLORS.muted, marginTop: 2 },
  check: { fontSize: 15, color: COLORS.primary, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: "88%",
  },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  sheetSubtitle: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  sheetClose: { paddingHorizontal: 8, paddingVertical: 4 },
  sheetCloseText: { fontSize: 13, color: COLORS.primary, fontWeight: "600" },
  sheetBody: { flexGrow: 0 },
  sheetFooter: { paddingTop: 10 },

  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  pagerText: { fontSize: 11, color: COLORS.muted },
});
