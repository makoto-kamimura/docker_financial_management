// 控除・確定申告の「必要な書類」（web 版の「やること・書類」タブと同じ内容）。書類ごとに、保存した証明書の写真と
// 「撮影して追加」「削除」。セルフメディケーション税制の対象として残したレシートの一覧も出す。
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  authedImage,
  deleteTaxDocument,
  fetchTaxDocuments,
  uploadTaxDocument,
  type SelfMedicationReceipt,
  type TaxDocumentFile,
  type TaxReturn,
} from "../api";
import { yen } from "../format";
import { shrink } from "./ReceiptScanButton";
import { Button, Card, COLORS, Notice, SectionTitle } from "./ui";

function Thumb({ file }: { file: { fileUrl: string; fileType: string; fileName: string } }) {
  if (file.fileType !== "image") {
    return (
      <View style={[s.thumb, s.pdf]}>
        <Text style={s.pdfText}>PDF</Text>
      </View>
    );
  }
  return (
    <Image source={authedImage(file.fileUrl)} style={s.thumb} accessibilityLabel={file.fileName} />
  );
}

export function TaxDocumentsSection({ data }: { data: TaxReturn }) {
  const e = data.estimate;
  const checked = new Set(data.inputs.checks);
  const [documents, setDocuments] = useState<TaxDocumentFile[]>([]);
  const [receipts, setReceipts] = useState<SelfMedicationReceipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetchTaxDocuments(data.year);
      setDocuments(r.documents);
      setReceipts(r.selfMedicationReceipts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "書類の一覧を取得できませんでした");
    }
  }, [data.year]);

  useEffect(() => {
    load();
  }, [load]);

  async function capture(docId: string) {
    setError("");
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("カメラを使う許可がありません。端末の設定で許可してください");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    setBusy(docId);
    try {
      await uploadTaxDocument(data.year, docId, await shrink(result.assets[0]));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "写真の保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete(file: TaxDocumentFile) {
    Alert.alert("写真を削除", `「${file.fileName}」を削除します。よろしいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTaxDocument(file.id);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  const total = receipts.reduce((sum, r) => sum + r.amount, 0);
  return (
    <>
      <Card style={s.card}>
        <SectionTitle>必要な書類</SectionTitle>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {e.documents.length === 0 ? (
          <Text style={s.muted}>今の入力では、集める書類はありません。</Text>
        ) : (
          e.documents.map((d) => {
            const files = documents.filter((f) => f.docId === d.id);
            return (
              <View key={d.id} style={s.section}>
                <Text style={s.body}>
                  {checked.has(`doc:${d.id}`) ? "✓ " : "○ "}
                  {d.label}
                </Text>
                <Text style={s.muted}>{d.why}</Text>
                <View style={s.files}>
                  {files.map((f) => (
                    <TouchableOpacity key={f.id} onLongPress={() => confirmDelete(f)}>
                      <Thumb file={f} />
                    </TouchableOpacity>
                  ))}
                </View>
                <Button
                  small
                  variant="secondary"
                  label={busy === d.id ? "保存中…" : "撮影して追加"}
                  loading={busy === d.id}
                  onPress={() => capture(d.id)}
                />
              </View>
            );
          })
        )}
        {documents.length > 0 ? (
          <Text style={s.muted}>写真を長押しすると削除できます。</Text>
        ) : null}
        {e.filing.willFile && (
          <TouchableOpacity
            onPress={() => Linking.openURL("https://www.keisan.nta.go.jp/")}
            hitSlop={4}
          >
            <Text style={s.link}>確定申告書等作成コーナー（国税庁）</Text>
          </TouchableOpacity>
        )}
      </Card>
      <Card style={s.card}>
        <SectionTitle note="確定申告の後 5 年間は保管">
          セルフメディケーションのレシート
        </SectionTitle>
        {receipts.length === 0 ? (
          <Text style={s.muted}>
            まだありません。実績のカレンダーでレシートを撮影して入力するときに「セルフメディケーション税制の対象」にすると、ここに残ります。
          </Text>
        ) : (
          <>
            {receipts.map((r) => (
              <View key={r.id} style={s.receipt}>
                <Thumb file={r} />
                <View style={s.receiptBody}>
                  <View style={s.receiptHead}>
                    <Text style={s.body} numberOfLines={1}>
                      {r.date?.replace(/-/g, "/")} {r.merchant}
                    </Text>
                    <Text style={s.amount}>{yen(r.amount)}</Text>
                  </View>
                  {r.items.length > 0 ? (
                    <Text style={s.muted}>
                      {r.items.map((i) => `${i.name} ${yen(i.amount)}`).join("、")}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
            <Text style={s.body}>
              合計 {yen(total)}（{receipts.length} 枚）。購入額への反映は Web 版で行います。
            </Text>
          </>
        )}
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: 12 },
  section: { marginBottom: 12, gap: 4 },
  body: { fontSize: 14, color: COLORS.text, flexShrink: 1 },
  muted: { fontSize: 12, color: COLORS.sub },
  link: { fontSize: 13, color: COLORS.primary, marginTop: 4 },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 4 },
  thumb: { width: 64, height: 64, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  pdf: { alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  pdfText: { fontSize: 12, color: COLORS.sub, fontWeight: "600" },
  receipt: { flexDirection: "row", gap: 10, marginBottom: 10 },
  receiptBody: { flex: 1, gap: 2 },
  receiptHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  amount: { fontSize: 14, fontWeight: "600", color: COLORS.text },
});
