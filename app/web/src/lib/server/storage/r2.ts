// 証憑を Cloudflare R2（S3 互換）に置く。バケットは非公開にし、配信はアプリ（/api/uploads）を通す。
// キーは <tenantId>/<savedName>（ローカルのフォルダ構成と同じ）。
// 移行のあいだは、R2 に無いファイルをローカルから読む（消すときは両方から消す）。
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { UploadStorage } from "@/lib/server/storage/types";

export type R2Settings = {
  accountId?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** テストで MinIO などに向けるときだけ（無ければ R2 のアカウントのエンドポイント） */
  endpoint?: string;
};

export const r2Key = (tenantId: number, savedName: string) => `${tenantId}/${savedName}`;

export function r2Client(s: R2Settings): S3Client {
  return new S3Client({
    region: "auto", // SDK が求めるだけで、R2 では使わない
    endpoint: s.endpoint ?? `https://${s.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(s.endpoint),
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // チェックサムは必要な操作のときだけ付ける（S3 互換のサービスで、既定の付け方を受け付けない場合がある）
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const isNotFound = (e: unknown) =>
  e instanceof NoSuchKey ||
  (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;

export function r2Storage(s: R2Settings, fallback: UploadStorage): UploadStorage {
  const client = r2Client(s);
  return {
    async put(tenantId, savedName, buf, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: s.bucket,
          Key: r2Key(tenantId, savedName),
          Body: buf,
          ContentType: contentType,
        }),
      );
    },
    async get(tenantId, savedName) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: s.bucket, Key: r2Key(tenantId, savedName) }),
        );
        if (!res.Body) return null;
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (e) {
        if (!isNotFound(e)) throw e;
        return fallback.get(tenantId, savedName); // まだ R2 に移していないファイル
      }
    },
    async remove(tenantId, savedName) {
      await client
        .send(new DeleteObjectCommand({ Bucket: s.bucket, Key: r2Key(tenantId, savedName) }))
        .catch((e) => console.error("[storage] r2 delete failed:", r2Key(tenantId, savedName), e));
      await fallback.remove(tenantId, savedName);
    },
  };
}
