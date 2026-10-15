// 実績管理のカレンダー（現金）の「レシートを撮影して入力」（web 版 ReceiptScanButton と同じ流れ）。
// 撮った写真を長辺 1600px の JPEG に縮めて読み取り、下書きと写真を親のフォームに渡す。
// 有料プランは高精度、無料プランは簡易の読み取り。有料プランの申し込みは web だけで行う
// （アプリには申し込みの画面もリンクも置かない）。
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  fetchReceiptScanStatus,
  scanReceipt,
  type ReceiptEngine,
  type ReceiptScanResult,
  type ReceiptScanStatus,
} from "../api";
import { Button, Notice } from "./ui";

const MAX_EDGE = 1600;

const ENGINE_LABELS: Record<ReceiptEngine, string> = {
  claude: "高精度の読み取り（有料プラン）",
  tesseract: "簡易の読み取り（精度は低め）",
};

const PAYMENT_WARNINGS: Partial<Record<ReceiptScanResult["draft"]["paymentMethod"], string>> = {
  card: "カード払いのレシートのようです。カードの明細から入る分と二重に計上しないよう注意してください。",
  emoney:
    "電子マネーや QR コード決済のレシートのようです。電子マネーの明細から入る分と二重に計上しないよう注意してください。",
};

/** 写真を長辺 MAX_EDGE の JPEG にする（送る量と読み取りの課金を抑える）。証明書の撮影でも使う */
export async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    ctx.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return saved.uri;
}

type Props = { onScanned: (result: ReceiptScanResult, photoUri: string) => void };

export function ReceiptScanButton({ onScanned }: Props) {
  const [status, setStatus] = useState<ReceiptScanStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchReceiptScanStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function pick(source: "camera" | "library") {
    setError("");
    setDone(false);
    setWarning(null);
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

    setScanning(true);
    try {
      const uri = await shrink(result.assets[0]);
      const scanned = await scanReceipt(uri);
      setWarning(PAYMENT_WARNINGS[scanned.draft.paymentMethod] ?? null);
      setDone(true);
      onScanned(scanned, uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み取りに失敗しました");
    } finally {
      setScanning(false);
      loadStatus();
    }
  }

  if (!status) return null;
  const disabled = scanning || status.reason !== null;

  return (
    <View style={s.wrap}>
      <View style={s.buttons}>
        <View style={{ flex: 1 }}>
          <Button
            label={scanning ? "読み取り中…" : "レシートを撮影"}
            variant="secondary"
            small
            disabled={disabled}
            loading={scanning}
            onPress={() => pick("camera")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="写真から選ぶ"
            variant="secondary"
            small
            disabled={disabled}
            onPress={() => pick("library")}
          />
        </View>
      </View>
      <Text style={s.note}>
        {ENGINE_LABELS[status.engine]}・今日あと {status.remaining} 回
      </Text>
      {status.upgradeAvailable && (
        <Text style={s.note}>Web の設定から有料プランにすると、高精度で読み取れます</Text>
      )}
      {status.reason ? <Notice tone="warn">{status.reason}</Notice> : null}
      {done && !error ? (
        <Notice tone="success">
          読み取った内容をフォームに入れました。確かめてから登録してください。
        </Notice>
      ) : null}
      {warning ? <Notice tone="warn">{warning}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 10 },
  buttons: { flexDirection: "row", gap: 8 },
  note: { fontSize: 11, color: "#94a3b8" },
});
