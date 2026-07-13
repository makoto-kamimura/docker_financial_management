// アップロードファイルの検証・保存名決定ロジック。
// journals/[id]/receipts（証憑アップロード）で使用する。

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
