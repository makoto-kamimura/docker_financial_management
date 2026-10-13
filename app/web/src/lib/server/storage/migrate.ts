// ローカル（/app/uploads）の証憑を R2 にコピーする（scripts/migrate-uploads-to-r2.ts から使う）。
// - 対象は savedName のある receipts の行。テナントは仕訳か現金の明細から求める
// - ローカルのファイルはテナントのフォルダ、無ければ旧構成の平置きから読み、R2 のキー
//   <tenantId>/<savedName> に入れる（平置きのファイルもこの形にそろう）
// - R2 に同じサイズのものがあれば飛ばす（何度流しても同じ結果）。サイズの違うものは上書きせず報告する
// - ローカルのファイルは消さない
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { contentTypeForExtension } from "@/lib/server/upload";
import { r2Client, r2Key, type R2Settings } from "@/lib/server/storage/r2";
import type { UploadStorage } from "@/lib/server/storage/types";

export type MigrationReport = {
  total: number;
  copied: number;
  skipped: number;
  /** ローカルにファイルが無い（または持ち主のテナントが分からない） */
  missing: string[];
  /** R2 に同じキーでサイズの違うものがある（上書きしない） */
  mismatched: string[];
};

async function r2Size(client: ReturnType<typeof r2Client>, bucket: string, key: string) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch (e) {
    if ((e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw e;
  }
}

export async function migrateUploadsToR2(opts: {
  db: Pick<PrismaClient, "receipt">;
  local: UploadStorage;
  r2: R2Settings;
  dryRun?: boolean;
}): Promise<MigrationReport> {
  const client = r2Client(opts.r2);
  const receipts = await opts.db.receipt.findMany({
    where: { savedName: { not: null } },
    select: {
      savedName: true,
      mimeType: true,
      journalEntry: { select: { tenantId: true } },
      financialRecord: { select: { tenantId: true } },
    },
    orderBy: { id: "asc" },
  });

  const report: MigrationReport = {
    total: receipts.length,
    copied: 0,
    skipped: 0,
    missing: [],
    mismatched: [],
  };
  for (const r of receipts) {
    const savedName = r.savedName!;
    const tenantId = r.journalEntry?.tenantId ?? r.financialRecord?.tenantId;
    const buf = tenantId === undefined ? null : await opts.local.get(tenantId, savedName);
    if (tenantId === undefined || !buf) {
      report.missing.push(savedName);
      continue;
    }
    const key = r2Key(tenantId, savedName);
    const size = await r2Size(client, opts.r2.bucket, key);
    if (size === buf.length) {
      report.skipped++;
      continue;
    }
    if (size !== null) {
      report.mismatched.push(key);
      continue;
    }
    if (!opts.dryRun) {
      const ext = savedName.split(".").pop() ?? "";
      await client.send(
        new PutObjectCommand({
          Bucket: opts.r2.bucket,
          Key: key,
          Body: buf,
          ContentType: r.mimeType || contentTypeForExtension(ext),
        }),
      );
    }
    report.copied++;
  }
  return report;
}
