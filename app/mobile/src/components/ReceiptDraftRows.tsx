// 仮の明細（撮ったレシート）の一覧（web 版 ReceiptDraftList と同じ内容）。読み取りの状況（読み取り中・
// 確認待ち・読み取れなかった）と、読み取った店名・金額を「仮」の印を付けて並べる。仮は集計に入らない。
// 「確かめて登録」で登録のフォームに入れ、読み取れなかったものは読み取り直すか、手で入力して登録する。
import { useState } from "react";
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { authedImage, deleteReceiptDraft, rereadReceiptDraft, type ReceiptDraftView } from "../api";
import { yen } from "../format";
import { Notice } from "./ui";

const md = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
};

export function ReceiptDraftRows({
  drafts,
  openId,
  onOpen,
  onChanged,
}: {
  drafts: ReceiptDraftView[];
  /** フォームに入れている仮 */
  openId: number | null;
  onOpen: (draft: ReceiptDraftView) => void;
  /** 削除・読み取り直しのあと（親が一覧を取り直す） */
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function run(id: number, action: () => Promise<void>) {
    setBusyId(id);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusyId(null);
      onChanged();
    }
  }

  function confirmDelete(d: ReceiptDraftView) {
    Alert.alert("仮の明細を削除", "この仮の明細と写真を削除します。よろしいですか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => void run(d.id, () => deleteReceiptDraft(d.id)),
      },
    ]);
  }

  if (drafts.length === 0) return null;
  return (
    <View style={s.wrap}>
      {drafts.map((d) => {
        const read = d.result?.draft;
        return (
          <View key={d.id} style={[s.row, openId === d.id && s.rowOpen]}>
            {d.photo ? (
              <Image
                source={authedImage(d.photo.fileUrl)}
                style={s.thumb}
                accessibilityLabel="撮ったレシート"
              />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>
                <Text style={s.badge}> 仮 </Text>{" "}
                {d.status === "READ" ? (read?.merchant ?? "店名なし") : null}
                {d.status === "READING" ? <Text style={s.sub}>読み取り中…</Text> : null}
                {d.status === "FAILED" ? <Text style={s.failed}>読み取れませんでした</Text> : null}
              </Text>
              {d.status === "READ" ? (
                <Text style={s.sub}>
                  {read?.total != null ? yen(read.total) : "金額なし"}
                  {read?.date && read.date !== d.date ? `・レシートの日付 ${md(read.date)}` : ""}
                </Text>
              ) : null}
              {d.status === "FAILED" && d.error ? <Text style={s.failed}>{d.error}</Text> : null}
              <View style={s.actions}>
                {d.status !== "READING" ? (
                  <TouchableOpacity onPress={() => onOpen(d)} hitSlop={6}>
                    <Text style={s.primary}>
                      {d.status === "READ" ? "確かめて登録" : "手で入力して登録"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {d.status === "FAILED" ? (
                  <TouchableOpacity
                    disabled={busyId === d.id}
                    onPress={() => void run(d.id, () => rereadReceiptDraft(d.id))}
                    hitSlop={6}
                  >
                    <Text style={s.secondary}>もう一度読み取る</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  disabled={busyId === d.id}
                  onPress={() => confirmDelete(d)}
                  hitSlop={6}
                >
                  <Text style={s.remove}>削除</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}
      <Text style={s.note}>仮の明細は集計に入りません。確かめて登録すると実績になります。</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginTop: 8 },
  row: {
    flexDirection: "row",
    gap: 8,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
  },
  rowOpen: { backgroundColor: "#fef3c7" },
  thumb: { width: 40, height: 50, borderRadius: 4, backgroundColor: "#fff" },
  title: { fontSize: 13, color: "#1e293b", fontWeight: "500" },
  badge: { color: "#fff", backgroundColor: "#f59e0b", fontSize: 10, fontWeight: "700" },
  sub: { fontSize: 11, color: "#64748b", marginTop: 2 },
  failed: { fontSize: 11, color: "#92400e", marginTop: 2 },
  actions: { flexDirection: "row", gap: 14, marginTop: 6 },
  primary: { fontSize: 12, color: "#4f46e5", fontWeight: "700" },
  secondary: { fontSize: 12, color: "#475569" },
  remove: { fontSize: 12, color: "#94a3b8" },
  note: { fontSize: 10, color: "#94a3b8" },
});
