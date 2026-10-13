/**
 * 証憑の置き場所 R2 と、ローカルから R2 への移行の結合テスト（実 DB と S3 互換のサーバー）
 *
 * - R2 に保存・読み出し・削除できる（キーは <tenantId>/<savedName>）
 * - R2 に無いファイルはローカルから読む（移行のあいだ）。消すときはローカルからも消す
 * - 移行: テナントのフォルダと旧構成の平置きのファイルを R2 にコピーする。2 回目はすべて飛ばし、
 *   --dry-run では書き込まない。R2 にサイズの違うものがあれば上書きせずに報告する
 *
 * R2 の代わりに MinIO を使う。R2_ENDPOINT・R2_ACCESS_KEY_ID・R2_SECRET_ACCESS_KEY・R2_BUCKET が
 * 無ければ飛ばす。例:
 *   docker run -d --rm -p 127.0.0.1:59000:9000 minio/minio server /data
 *   R2_ENDPOINT=http://127.0.0.1:59000 R2_ACCESS_KEY_ID=minioadmin R2_SECRET_ACCESS_KEY=minioadmin \
 *     R2_BUCKET=receipts npm run test:integration
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/prisma";
import { localStorage } from "@/lib/server/storage/local";
import { r2Client, r2Key, r2Storage, type R2Settings } from "@/lib/server/storage/r2";
import { migrateUploadsToR2 } from "@/lib/server/storage/migrate";

const env = process.env;
const enabled = Boolean(
  env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
);
const settings: R2Settings = {
  endpoint: env.R2_ENDPOINT,
  accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
  bucket: env.R2_BUCKET ?? "",
};
const SUFFIX = `r2_${Date.now()}`;

async function r2Object(key: string): Promise<string | null> {
  try {
    const res = await r2Client(settings).send(
      new GetObjectCommand({ Bucket: settings.bucket, Key: key }),
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch {
    return null;
  }
}

describe.skipIf(!enabled)("R2 の置き場所", () => {
  let dir: string;
  let tenantId: number;
  const names = {
    inTenantDir: `${SUFFIX}_a.jpg`,
    legacy: `${SUFFIX}_b.pdf`,
    mismatch: `${SUFFIX}_c.jpg`,
    missing: `${SUFFIX}_d.jpg`,
  };

  beforeAll(async () => {
    const client = r2Client(settings);
    try {
      await client.send(new HeadBucketCommand({ Bucket: settings.bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: settings.bucket }));
    }
    dir = await mkdtemp(path.join(os.tmpdir(), "uploads-"));
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('tenants', 'id'), COALESCE((SELECT MAX(id) FROM tenants), 1))`,
    );
    tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  });

  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { journalEntry: { tenantId } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
    const s = r2Storage(settings, localStorage(dir));
    for (const name of Object.values(names)) await s.remove(tenantId, name);
    await rm(dir, { recursive: true, force: true });
  });

  it("保存・読み出し・削除。キーは <tenantId>/<savedName>", async () => {
    const s = r2Storage(settings, localStorage(dir));
    const name = `${SUFFIX}_put.jpg`;
    await s.put(tenantId, name, Buffer.from("photo"), "image/jpeg");
    expect(await r2Object(r2Key(tenantId, name))).toBe("photo");
    expect(existsSync(path.join(dir, String(tenantId), name))).toBe(false); // ローカルには書かない
    expect((await s.get(tenantId, name))?.toString()).toBe("photo");

    await s.remove(tenantId, name);
    expect(await r2Object(r2Key(tenantId, name))).toBeNull();
    expect(await s.get(tenantId, name)).toBeNull();
  });

  it("R2 に無いファイルはローカルから読み、消すときはローカルからも消す", async () => {
    const s = r2Storage(settings, localStorage(dir));
    const name = `${SUFFIX}_local.jpg`;
    await mkdir(path.join(dir, String(tenantId)), { recursive: true });
    await writeFile(path.join(dir, String(tenantId), name), "local");
    expect((await s.get(tenantId, name))?.toString()).toBe("local");

    await s.remove(tenantId, name);
    expect(existsSync(path.join(dir, String(tenantId), name))).toBe(false);
  });

  it("移行: ローカルの証憑を R2 にコピーし、2 回目は飛ばす。--dry-run は書き込まない", async () => {
    const journal = await prisma.journalEntry.create({
      data: { tenantId, transactionDate: new Date("2026-10-01"), description: "証憑の移行" },
    });
    const receipt = (savedName: string, mimeType: string) =>
      prisma.receipt.create({
        data: {
          journalEntryId: journal.id,
          fileName: savedName,
          fileUrl: `/api/uploads/${savedName}`,
          savedName,
          mimeType,
          fileType: "image",
          fileSize: 1,
        },
      });
    await mkdir(path.join(dir, String(tenantId)), { recursive: true });
    await writeFile(path.join(dir, String(tenantId), names.inTenantDir), "tenant-dir");
    await writeFile(path.join(dir, names.legacy), "legacy"); // 旧構成の平置き
    await writeFile(path.join(dir, String(tenantId), names.mismatch), "local-version");
    await receipt(names.inTenantDir, "image/jpeg");
    await receipt(names.legacy, "application/pdf");
    await receipt(names.mismatch, "image/jpeg");
    await receipt(names.missing, "image/jpeg"); // ローカルにファイルが無い
    // R2 に、同じキーでサイズの違うものがある
    await r2Client(settings).send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: r2Key(tenantId, names.mismatch),
        Body: "r2",
      }),
    );

    // 自テナントの行だけを対象にする（ほかのテストの行を巻き込まない）
    const db = {
      receipt: {
        findMany: (args: Parameters<typeof prisma.receipt.findMany>[0]) =>
          prisma.receipt.findMany({
            ...args,
            where: { ...args?.where, journalEntry: { tenantId } },
          }),
      },
    } as unknown as Parameters<typeof migrateUploadsToR2>[0]["db"];
    const opts = { db, local: localStorage(dir), r2: settings };

    const dry = await migrateUploadsToR2({ ...opts, dryRun: true });
    expect(dry).toMatchObject({ total: 4, copied: 2, skipped: 0 });
    expect(await r2Object(r2Key(tenantId, names.inTenantDir))).toBeNull();

    const first = await migrateUploadsToR2(opts);
    expect(first).toMatchObject({
      total: 4,
      copied: 2,
      skipped: 0,
      missing: [names.missing],
      mismatched: [r2Key(tenantId, names.mismatch)],
    });
    expect(await r2Object(r2Key(tenantId, names.inTenantDir))).toBe("tenant-dir");
    expect(await r2Object(r2Key(tenantId, names.legacy))).toBe("legacy");
    expect(await r2Object(r2Key(tenantId, names.mismatch))).toBe("r2"); // 上書きしない
    // ローカルのファイルは消さない
    expect(existsSync(path.join(dir, names.legacy))).toBe(true);

    const second = await migrateUploadsToR2(opts);
    expect(second).toMatchObject({ copied: 0, skipped: 2 });
  });
});
