// アップロードファイルの検証・保存名決定ロジック。
// 証憑のアップロード（journals/[id]/receipts・actuals/[id]/receipts）と、レシートの読み取り
// （actuals/receipt-scan）で使用する。
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/server/config";
import { badRequest } from "@/lib/server/api-error";
import { uploadStorage } from "@/lib/server/storage";

// 置き場所（ローカル / R2）は lib/server/storage/ で選ぶ。ローカルのフォルダの決まりはそちらにある
export { UPLOAD_DIR, tenantUploadDir } from "@/lib/server/storage/local";
/** 1 ファイルの上限（環境変数 UPLOAD_MAX_BYTES、既定 10MB） */
export const maxUploadBytes = (): number => getConfig().UPLOAD_MAX_BYTES;

/** 上限を超えたときの文言（「10MB」のように MB で示す） */
export function uploadTooLargeMessage(maxBytes: number = maxUploadBytes()): string {
  const mb = maxBytes / (1024 * 1024);
  return `ファイルサイズは ${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB 以下にしてください`;
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

/** 検証済みのアップロード（multipart の file） */
export type UploadedFile = {
  fileName: string;
  ext: string;
  mimeType: string;
  size: number;
  buf: Buffer;
  /** file 以外の項目を読むためのフォーム */
  form?: FormData;
};

/**
 * multipart の file を読み、サイズ・拡張子と MIME タイプ・先頭のバイトを確かめる（不正なら 400）。
 * imagesOnly なら画像（jpg/png/gif/webp）だけを受け付ける。
 */
export async function readUploadedFile(
  req: Request,
  opts: { imagesOnly?: boolean } = {},
): Promise<UploadedFile> {
  // リクエストボディがサーバー側の上限を超えて切り詰められた場合、formData() のパースが
  // 例外を投げる（Next.js のデフォルト body size 制限）。500 ではなく 400 として扱う
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    throw badRequest(uploadTooLargeMessage());
  }
  const file = formData.get("file");
  if (!(file instanceof File)) throw badRequest("file is required");
  if (file.size > maxUploadBytes()) throw badRequest(uploadTooLargeMessage());

  const ext = resolveUploadExtension(file.name, file.type);
  const mimeType = ext ? file.type || contentTypeForExtension(ext) : "";
  if (opts.imagesOnly && (!ext || classifyFileType(mimeType) !== "image")) {
    throw badRequest("画像（jpg/png/gif/webp）を送ってください");
  }
  if (!ext) throw badRequest("許可されていないファイル形式です（pdf/jpg/png/gif/webp のみ）");

  const buf = Buffer.from(await file.arrayBuffer());
  // S-8: マジックバイト検証。拡張子・Content-Type の詐称（内容不一致）を検出する
  if (!matchesMagicBytes(buf, ext)) throw badRequest("ファイルの内容が拡張子と一致しません");
  return { fileName: file.name, ext, mimeType, size: file.size, buf, form: formData };
}

/** テナントの置き場所に保存し、証憑（Receipt）の行に入れる列を返す */
export async function storeTenantUpload(tenantId: number, upload: UploadedFile) {
  const savedName = `${randomUUID()}.${upload.ext}`;
  await uploadStorage().put(tenantId, savedName, upload.buf, upload.mimeType);
  return {
    fileName: upload.fileName,
    // D-7: fileUrl 列は 1 リリース据え置き後に削除予定のため書き込みは維持するが、
    // レスポンスは resolveReceiptFileUrl() の導出値を返す
    fileUrl: `/api/uploads/${savedName}`,
    savedName,
    mimeType: upload.mimeType,
    fileType: classifyFileType(upload.mimeType),
    fileSize: upload.size,
  };
}

/** 保存したファイルを消す（ベストエフォート。旧フラット構成のファイルも探す） */
export async function removeTenantUpload(tenantId: number, savedName: string): Promise<void> {
  await uploadStorage().remove(tenantId, savedName);
}
