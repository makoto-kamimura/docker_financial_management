// アップロードファイルの検証・保存名決定ロジック。
// journals/[id]/receipts（証憑アップロード）で使用する。
import path from "node:path";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

// S-8: 証憑ファイルはテナントごとにディレクトリを分離して保存する
// （旧: uploads/<savedName> 直下フラット構成。既存ファイルは uploads/[filename] の GET で
// フォールバック参照する。1 リリース併存後、移行スクリプトでの一括移動を検討）
export function tenantUploadDir(tenantId: number): string {
  return path.join(UPLOAD_DIR, String(tenantId));
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export const ALLOWED_EXTENSIONS = Object.keys(CONTENT_TYPES);

export function contentTypeForExtension(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

// アップロードファイルの拡張子と MIME タイプから、保存に使う正規化済み拡張子を決定する。
// 許可リスト外の拡張子・MIME タイプは null を返す（呼び出し側で 400 にする）。
export function resolveUploadExtension(fileName: string, mimeType: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) return null;
  const expected = contentTypeForExtension(ext);
  if (mimeType && mimeType !== expected) return null;
  return ext;
}

export function classifyFileType(mimeType: string): "image" | "pdf" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "other";
}

// D-7: Receipt.fileUrl は savedName から機械的に導出できる値（/api/uploads/<savedName>）の
// 重複保存になっている。API レスポンス組み立て時はこの関数で savedName から導出した値を優先し、
// 保存済みカラムは信用しない（カラム自体は 1 リリース据え置き後に削除予定のためまだ残す）。
// savedName が null の旧行（S-1 移行時に fileUrl から逆算できなかった行）だけ、保存済み
// fileUrl にフォールバックする（ダウンロードが壊れないようにするため）。
export function resolveReceiptFileUrl(receipt: {
  savedName: string | null;
  fileUrl: string;
}): string {
  return receipt.savedName ? `/api/uploads/${receipt.savedName}` : receipt.fileUrl;
}

// S-8: マジックバイト（ファイル先頭のバイト列）が拡張子と整合するか検証する。
// ファイル名・Content-Type だけを詐称したアップロード（例: スクリプトを .pdf にリネーム）を
// 拡張子・MIME チェックだけでは検出できないため、実際のバイト内容も確認する。
export function matchesMagicBytes(buf: Buffer, ext: string): boolean {
  switch (ext.toLowerCase()) {
    case "pdf":
      return buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
    case "jpg":
    case "jpeg":
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "png":
      return (
        buf.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)
      );
    case "gif":
      return (
        buf.length >= 6 &&
        buf.subarray(0, 3).toString("latin1") === "GIF" &&
        ["87a", "89a"].includes(buf.subarray(3, 6).toString("latin1"))
      );
    case "webp":
      return (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString("latin1") === "RIFF" &&
        buf.subarray(8, 12).toString("latin1") === "WEBP"
      );
    default:
      return false;
  }
}
