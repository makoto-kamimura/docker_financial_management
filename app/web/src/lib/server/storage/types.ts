// 証憑のファイルの置き場所。ローカル（web コンテナの /app/uploads）か Cloudflare R2 を、
// 環境変数 UPLOAD_STORAGE で選ぶ（./index.ts）。ファイルはテナントと保存名で指す。
export interface UploadStorage {
  /** 保存する */
  put(tenantId: number, savedName: string, buf: Buffer, contentType: string): Promise<void>;
  /** 読み出す。無ければ null */
  get(tenantId: number, savedName: string): Promise<Buffer | null>;
  /** 消す（ベストエフォート。無くてもエラーにしない） */
  remove(tenantId: number, savedName: string): Promise<void>;
}
