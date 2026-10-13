// 証憑をローカル（web コンテナの /app/uploads、docker ボリューム）に置く。
// S-8: テナントごとのフォルダ（uploads/<tenantId>/<savedName>）に置く。旧構成の平置き
// （uploads/<savedName>）のファイルも読み出し・削除できるようにしておく。
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import type { UploadStorage } from "@/lib/server/storage/types";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export function tenantUploadDir(tenantId: number, baseDir: string = UPLOAD_DIR): string {
  return path.join(baseDir, String(tenantId));
}

async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export function localStorage(baseDir: string = UPLOAD_DIR): UploadStorage {
  const tenantPath = (tenantId: number, savedName: string) =>
    path.join(tenantUploadDir(tenantId, baseDir), savedName);
  const legacyPath = (savedName: string) => path.join(baseDir, savedName);

  return {
    async put(tenantId, savedName, buf) {
      await mkdir(tenantUploadDir(tenantId, baseDir), { recursive: true });
      await writeFile(tenantPath(tenantId, savedName), buf);
    },
    async get(tenantId, savedName) {
      return (
        (await readIfExists(tenantPath(tenantId, savedName))) ??
        (await readIfExists(legacyPath(savedName)))
      );
    },
    async remove(tenantId, savedName) {
      await unlink(tenantPath(tenantId, savedName)).catch(() =>
        unlink(legacyPath(savedName)).catch(() => {}),
      );
    },
  };
}
