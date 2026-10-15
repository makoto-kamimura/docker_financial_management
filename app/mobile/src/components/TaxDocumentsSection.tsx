// 控除・確定申告の書類のファイル（web 版の components/tax-return/DocumentFiles.tsx と同じ考え方）。
// 証明書の写真の「撮影」「写真を選ぶ」は、それぞれの控除の項目のそばに置き、「やること・書類」は保存済みかどうかだけを出す。
// 書類は画面で 1 回読み、TaxDocumentsProvider で各タブに配る。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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
import {
  documentStatus,
  documentsAt,
  showDocument,
  TAX_DOCUMENTS,
  type TaxDocumentId,
  type TaxDocumentPlace,
} from "../shared/tax-documents";
import { shrink } from "./ReceiptScanButton";
import { Button, Card, COLORS, Notice, SectionTitle } from "./ui";

type DocsState = {
  year: number;
  /** 今の入力で要る書類（見込みの documents） */
  documents: { id: string }[];
  files: TaxDocumentFile[];
  receipts: SelfMedicationReceipt[];
  loaded: boolean;
  reload: () => Promise<void>;
};

const DocsContext = createContext<DocsState | null>(null);

export function TaxDocumentsProvider({
  year,
  documents,
  children,
}: {
  year: number;
  documents: { id: string }[];
  children: ReactNode;
}) {
  const [files, setFiles] = useState<TaxDocumentFile[]>([]);
  const [receipts, setReceipts] = useState<SelfMedicationReceipt[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetchTaxDocuments(year);
      setFiles(r.documents);
      setReceipts(r.selfMedicationReceipts);
    } catch {
      // 読めなくても入力の閲覧はできるので、空のままにする
    } finally {
      setLoaded(true);
    }
  }, [year]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <DocsContext.Provider value={{ year, documents, files, receipts, loaded, reload }}>
      {children}
    </DocsContext.Provider>
  );
}

function useDocs(): DocsState {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error("TaxDocumentsProvider の中で使ってください");
  return ctx;
}

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

/** 1 つの書類の写真（長押しで削除）と「撮影」「写真を選ぶ」。要らずファイルも無ければ出さない */
function TaxDocumentUpload({ docId }: { docId: TaxDocumentId }) {
  const { year, documents, files: all, reload } = useDocs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const files = all.filter((f) => f.docId === docId);
  if (!showDocument(docId, documents, files)) return null;

  async function pick(source: "camera" | "library") {
    setError("");
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
    let result: ImagePicker.ImagePickerResult;
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("カメラを使う許可がありません。端末の設定で許可してください");
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    try {
      await uploadTaxDocument(year, docId, await shrink(result.assets[0]));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "写真の保存に失敗しました");
    } finally {
      setBusy(false);
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
            await reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  return (
    <View style={s.upload}>
      <Text style={s.uploadTitle}>
        {TAX_DOCUMENTS[docId].label}
        <Text style={files.length > 0 ? s.saved : s.unsaved}>
          {files.length > 0 ? `  保存済み ${files.length} 枚` : "  未保存"}
        </Text>
      </Text>
      {files.length > 0 ? (
        <View style={s.files}>
          {files.map((f) => (
            <TouchableOpacity key={f.id} onLongPress={() => confirmDelete(f)}>
              <Thumb file={f} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <View style={s.buttons}>
        <Button
          small
          variant="secondary"
          label="撮影"
          loading={busy}
          onPress={() => pick("camera")}
        />
        <Button
          small
          variant="secondary"
          label="写真を選ぶ"
          disabled={busy}
          onPress={() => pick("library")}
        />
      </View>
      {files.length > 0 ? <Text style={s.muted}>写真を長押しすると削除できます。</Text> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}

/** 置き場所の書類の撮影の欄をまとめて出す */
export function TaxDocumentUploads({ place }: { place: TaxDocumentPlace }) {
  return (
    <>
      {documentsAt(place)
        .filter((id) => TAX_DOCUMENTS[id].uploadable)
        .map((id) => (
          <TaxDocumentUpload key={id} docId={id} />
        ))}
    </>
  );
}

/** セルフメディケーション税制の対象として残したレシート（医療費控除の項目に出す） */
export function SelfMedicationReceiptList({ show }: { show: boolean }) {
  const { receipts } = useDocs();
  if (!show && receipts.length === 0) return null;
  const total = receipts.reduce((sum, r) => sum + r.amount, 0);
  return (
    <View style={s.upload}>
      <Text style={s.uploadTitle}>セルフメディケーションのレシート</Text>
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
            合計 {yen(total)}（{receipts.length} 枚）。購入額への反映は Web
            版で行います。確定申告の後 5 年間は保管が必要です。
          </Text>
        </>
      )}
    </View>
  );
}

/** 「やること・書類」の必要な書類。保存済みかどうかと、撮影する場所を出す */
export function TaxDocumentStatusCard({ data }: { data: TaxReturn }) {
  const { files, receipts, loaded } = useDocs();
  const e = data.estimate;
  const checked = new Set(data.inputs.checks);
  const status = new Map(
    documentStatus(e.documents, files, receipts.length).map((st) => [st.id, st]),
  );
  const where = (id: string) => {
    const place = (TAX_DOCUMENTS as Record<string, { place: TaxDocumentPlace }>)[id]?.place;
    if (!place || place === "filing") return null;
    if (place === "income" || place === "business") return "「概要」の内訳で撮影";
    if (place === "housing") return "「控除」の住宅ローン控除で撮影";
    return "「控除」の各控除で撮影";
  };
  return (
    <Card style={s.card}>
      <SectionTitle>必要な書類</SectionTitle>
      {e.documents.length === 0 ? (
        <Text style={s.muted}>今の入力では、集める書類はありません。</Text>
      ) : (
        e.documents.map((d) => {
          const st = status.get(d.id);
          const kept = d.id === "selfMedicationStatement" ? "保存したレシート" : "保存済み";
          return (
            <View key={d.id} style={s.section}>
              <Text style={s.body}>
                {checked.has(`doc:${d.id}`) ? "✓ " : "○ "}
                {d.label}
              </Text>
              <Text style={s.muted}>
                {d.why}
                {where(d.id) ? `・${where(d.id)}` : ""}
              </Text>
              {!loaded ? null : d.id === "myNumber" ? (
                <Text style={s.muted}>提出のときに用意（保存しません）</Text>
              ) : st && st.count > 0 ? (
                <Text style={s.saved}>
                  {kept} {st.count} 枚
                </Text>
              ) : (
                <Text style={s.unsaved}>未保存</Text>
              )}
            </View>
          );
        })
      )}
      {e.filing.willFile && (
        <TouchableOpacity
          onPress={() => Linking.openURL("https://www.keisan.nta.go.jp/")}
          hitSlop={4}
        >
          <Text style={s.link}>確定申告書等作成コーナー（国税庁）</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: 12 },
  section: { marginBottom: 12, gap: 2 },
  body: { fontSize: 14, color: COLORS.text, flexShrink: 1 },
  muted: { fontSize: 12, color: COLORS.sub },
  saved: { fontSize: 12, color: COLORS.success, fontWeight: "600" },
  unsaved: { fontSize: 12, color: "#b45309", fontWeight: "600" },
  link: { fontSize: 13, color: COLORS.primary, marginTop: 4 },
  upload: {
    marginTop: 8,
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.border,
    borderRadius: 8,
    gap: 6,
  },
  uploadTitle: { fontSize: 13, color: COLORS.text, fontWeight: "600" },
  buttons: { flexDirection: "row", gap: 8 },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  pdf: { alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  pdfText: { fontSize: 12, color: COLORS.sub, fontWeight: "600" },
  receipt: { flexDirection: "row", gap: 10, marginBottom: 6 },
  receiptBody: { flex: 1, gap: 2 },
  receiptHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  amount: { fontSize: 14, fontWeight: "600", color: COLORS.text },
});
