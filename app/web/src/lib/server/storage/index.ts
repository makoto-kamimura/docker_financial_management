// 証憑の置き場所を選ぶ。UPLOAD_STORAGE=r2 なら Cloudflare R2、それ以外（既定）はローカル。
import { Env } from "@/lib/server/config-schema";
import { localStorage } from "@/lib/server/storage/local";
import { r2Storage, type R2Settings } from "@/lib/server/storage/r2";
import type { UploadStorage } from "@/lib/server/storage/types";

const StorageEnv = Env.pick({
  UPLOAD_STORAGE: true,
  R2_ACCOUNT_ID: true,
  R2_ACCESS_KEY_ID: true,
  R2_SECRET_ACCESS_KEY: true,
  R2_BUCKET: true,
  R2_ENDPOINT: true,
});
type StorageSettings = ReturnType<typeof StorageEnv.parse>;

/** R2 の設定（UPLOAD_STORAGE=r2 なのに足りなければ、足りない変数の名前を挙げて例外） */
export function r2Settings(s: StorageSettings): R2Settings {
  const missing = (
    [
      ["R2_ACCESS_KEY_ID", s.R2_ACCESS_KEY_ID],
      ["R2_SECRET_ACCESS_KEY", s.R2_SECRET_ACCESS_KEY],
      ["R2_BUCKET", s.R2_BUCKET],
      ["R2_ACCOUNT_ID または R2_ENDPOINT", s.R2_ACCOUNT_ID ?? s.R2_ENDPOINT],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`R2 を使うには ${missing.join("・")} の設定が要ります`);
  }
  return {
    accountId: s.R2_ACCOUNT_ID,
    accessKeyId: s.R2_ACCESS_KEY_ID!,
    secretAccessKey: s.R2_SECRET_ACCESS_KEY!,
    bucket: s.R2_BUCKET!,
    endpoint: s.R2_ENDPOINT,
  };
}

// 設定が変わらないあいだは同じクライアントを使い回す。設定は呼ぶたびに読む
// （課金の設定と同じく、結合テストで置き場所を切り替えられるように）
let cached: { key: string; storage: UploadStorage } | null = null;

export function uploadStorage(): UploadStorage {
  const s = StorageEnv.parse(process.env);
  const key = JSON.stringify(s);
  if (cached?.key === key) return cached.storage;
  const local = localStorage();
  const storage = s.UPLOAD_STORAGE === "r2" ? r2Storage(r2Settings(s), local) : local;
  cached = { key, storage };
  return storage;
}
