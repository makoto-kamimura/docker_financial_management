// 事業利用（個人事業主モードで事業の分として数える印）の部品（web 版の BusinessUseToggle・BusinessTag・
// 未割り当ての一覧の BusinessCell・明細の一覧の「事業利用のみ」と同じ働き）。
//   - BusinessTag: 明細の一覧に出す「事業 n%」
//   - BusinessRatioControl: 明細の事業利用（印）と按分（%）。按分は入れ終えたときに保存する
//   - BusinessUseSwitch: 口座・カード・資産・借入金の登録と編集の「事業利用」
//   - useBusinessOnlyFilter: 個人事業主モードの明細の一覧を「事業利用のみ」に絞る
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import type { ViewMode } from "../api";
import { BUSINESS_USE_LABEL, businessUseText, isValidBusinessRatio } from "../shared/business-use";
import { LedgerBadge } from "./LedgerRow";
import { COLORS, Input } from "./ui";

export function BusinessTag({
  businessUse,
  businessRatio,
}: {
  businessUse: boolean;
  businessRatio: number | null;
}) {
  const text = businessUseText(businessUse, businessRatio);
  return text ? <LedgerBadge tone="indigo">{text}</LedgerBadge> : null;
}

/**
 * 明細の事業利用と按分。印を切り替えるとすぐ保存し、按分は入れ終えたとき（編集を終えたとき）に保存する。
 * 按分を空けて保存すると、科目の事業利用按分の割合（無ければ 100%）になる。
 * live なら按分を打つたびに知らせる（登録のフォーム用。範囲の確かめは登録のときに行う）
 */
export function BusinessRatioControl({
  businessUse,
  businessRatio,
  disabled,
  live,
  onChange,
}: {
  businessUse: boolean;
  businessRatio: number | null;
  disabled?: boolean;
  live?: boolean;
  onChange: (change: { businessUse: boolean; businessRatio?: number | null }) => void;
}) {
  const [ratio, setRatio] = useState(businessRatio?.toString() ?? "");
  useEffect(() => {
    // 打っている途中の値（"12." など）を上書きしないよう、数値として違うときだけ合わせる
    setRatio((r) =>
      (r.trim() === "" ? null : Number(r)) === businessRatio
        ? r
        : (businessRatio?.toString() ?? ""),
    );
  }, [businessRatio]);
  const invalid = ratio.trim() !== "" && !isValidBusinessRatio(Number(ratio));

  function saveRatio() {
    const next = ratio.trim() === "" ? null : Number(ratio);
    if (invalid || next === businessRatio) return;
    onChange({ businessUse: true, businessRatio: next });
  }

  return (
    <View style={s.row}>
      <Switch
        value={businessUse}
        disabled={disabled}
        onValueChange={(v) => onChange({ businessUse: v })}
        accessibilityLabel={BUSINESS_USE_LABEL}
        style={s.switch}
      />
      <Text style={s.label}>事業</Text>
      {businessUse && (
        <>
          <Input
            value={ratio}
            onChangeText={(t) => {
              setRatio(t);
              if (live)
                onChange({ businessUse: true, businessRatio: t.trim() === "" ? null : Number(t) });
            }}
            onEndEditing={saveRatio}
            keyboardType="decimal-pad"
            placeholder="既定"
            editable={!disabled}
            accessibilityLabel="按分（%）"
            style={[s.ratio, invalid && s.invalid]}
          />
          <Text style={s.label}>%</Text>
        </>
      )}
    </View>
  );
}

const HINTS = {
  account:
    "事業で使う口座・カードです。個人事業主モードで表示・集計し、取り込んだ明細も事業利用で入ります。",
  asset: "事業で使う資産です。個人事業主モードで表示・集計します。",
  loan: "事業のための借入です。個人事業主モードで表示・集計します。",
} as const;

export function BusinessUseSwitch({
  value,
  onChange,
  kind,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  kind: keyof typeof HINTS;
}) {
  return (
    <View style={s.field}>
      <View style={s.row}>
        <Switch value={value} onValueChange={onChange} accessibilityLabel={BUSINESS_USE_LABEL} />
        <Text style={s.fieldLabel}>{BUSINESS_USE_LABEL}</Text>
      </View>
      <Text style={s.hint}>{HINTS[kind]}</Text>
    </View>
  );
}

/**
 * 個人事業主モードの明細の一覧を「事業利用のみ」に絞る（既定は絞る。切り替えで全件）。
 * 家庭・法人モードでは絞らず、切り替えも出さない
 */
export function useBusinessOnlyFilter(viewMode: ViewMode): {
  keep: <T extends { businessUse: boolean }>(rows: T[]) => T[];
  toggle: ReactNode;
} {
  const sole = viewMode === "sole";
  const [businessOnly, setBusinessOnly] = useState(true);
  const active = sole && businessOnly;
  return {
    keep: (rows) => (active ? rows.filter((r) => r.businessUse) : rows),
    toggle: sole ? (
      <View style={s.row}>
        <Switch
          value={businessOnly}
          onValueChange={setBusinessOnly}
          accessibilityLabel="事業利用のみ"
        />
        <Text style={s.label}>事業利用のみ</Text>
      </View>
    ) : null,
  };
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  switch: { transform: [{ scale: 0.8 }] },
  label: { fontSize: 12, color: "#475569" },
  ratio: { width: 64, paddingVertical: 4, fontSize: 12 },
  invalid: { borderColor: "#dc2626" },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, color: "#334155", fontWeight: "500" },
  hint: { fontSize: 11, color: COLORS.sub, marginTop: 2, lineHeight: 16 },
});
