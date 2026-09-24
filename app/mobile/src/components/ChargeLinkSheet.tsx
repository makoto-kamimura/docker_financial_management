// チャージ（銀行口座・カード → デビット / プリペイド / 電子マネー）を指定するときに、
// チャージ先に入った明細を選んで対にするシート（web 版 components/ChargeLinkModal.tsx と同じ内容）。
// チャージ先に入金行があるのに対にしないと、同じ資金が収入として二重に効くため、ここで対にして両方を
// 収支の対象外にする。入金の記録が無ければ「紐づけずに指定」を選ぶ。
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchChargeCandidates, type ChargeCandidate } from "../api";
import { fmtDate, yen } from "../format";
import { Button, SheetModal } from "./ui";

type Props = {
  /** チャージ元の明細（銀行明細・カード明細のどちらでも）。null で閉じる */
  source: { date: string; description: string; amount: number } | null;
  /** チャージ先のカード・電子マネー */
  target: { id: number; name: string } | null;
  onCancel: () => void;
  /** 選んだチャージ先の明細 id。紐付けない場合は null */
  onConfirm: (pairTxnId: number | null) => void;
};

export function ChargeLinkSheet({ source, target, onCancel, onConfirm }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ChargeCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelected(null);
    if (!source || !target) return;
    setLoading(true);
    fetchChargeCandidates({ targetAccountId: target.id, amount: source.amount, date: source.date })
      .then(setCandidates)
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [source, target]);

  return (
    <SheetModal
      visible={source !== null && target !== null}
      title="チャージ先の履歴と紐付ける"
      subtitle={
        target
          ? `この明細を ${target.name} へのチャージとして指定します。チャージ先にも入金の記録がある場合は、` +
            "その明細を選んで紐付けてください（両方が収入・支出の集計から外れ、二重計上を防げます）。"
          : undefined
      }
      onClose={onCancel}
      footer={
        <View style={s.footer}>
          <Button
            variant="secondary"
            small
            label="紐づけずに指定"
            onPress={() => onConfirm(null)}
          />
          <Button
            small
            label="紐づけて指定"
            disabled={selected === null}
            onPress={() => selected !== null && onConfirm(selected)}
          />
        </View>
      }
    >
      {source && (
        <Text style={s.source}>
          チャージ元: {fmtDate(source.date)} · {source.description} · {yen(Math.abs(source.amount))}
        </Text>
      )}
      {loading ? (
        <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
      ) : candidates.length === 0 ? (
        <Text style={s.empty}>
          {target?.name} に、この日付の前後で紐付けできる明細は見つかりませんでした。まだ CSV
          を取り込んでいない、または入金の記録が出てこないカードの場合は「紐づけずに指定」を選んでください。
        </Text>
      ) : (
        candidates.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[s.row, selected === c.id && s.rowSelected]}
            onPress={() => setSelected(c.id === selected ? null : c.id)}
          >
            <View style={[s.radio, selected === c.id && s.radioOn]} />
            <View style={{ flex: 1 }}>
              <Text style={s.desc} numberOfLines={1}>
                {fmtDate(c.date)} {c.description}
              </Text>
              <Text style={s.tags}>
                {[
                  c.amountMatch && "金額一致",
                  c.incoming && "入金",
                  c.dayGap > 0 && `${c.dayGap}日ずれ`,
                  c.categoryAccount && "科目あり（紐付けると外れます）",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Text style={s.amount}>{yen(Math.abs(c.amount))}</Text>
          </TouchableOpacity>
        ))
      )}
    </SheetModal>
  );
}

const s = StyleSheet.create({
  source: {
    fontSize: 12,
    color: "#475569",
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  empty: { fontSize: 12, color: "#64748b", lineHeight: 18, paddingVertical: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  rowSelected: { backgroundColor: "#eef2ff" },
  radio: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: "#cbd5e1" },
  radioOn: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  desc: { fontSize: 13, color: "#334155" },
  tags: { fontSize: 10, color: "#64748b", marginTop: 2 },
  amount: { fontSize: 13, color: "#475569", fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
});
