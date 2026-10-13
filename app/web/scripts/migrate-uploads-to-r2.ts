// ローカル（/app/uploads）の証憑を Cloudflare R2 にコピーする。手順は docs/runbooks/uploads-to-r2.md。
// 使い方（web コンテナの中で）: npx tsx scripts/migrate-uploads-to-r2.ts [--dry-run]
//   R2_* の環境変数（.env）が要る。UPLOAD_STORAGE は問わない。ローカルのファイルは消さない。
//   何度流しても同じ結果になる（R2 に同じサイズのものがあれば飛ばす）。
import { prisma } from "../src/lib/server/prisma";
import { Env } from "../src/lib/server/config-schema";
import { r2Settings } from "../src/lib/server/storage";
import { localStorage } from "../src/lib/server/storage/local";
import { migrateUploadsToR2 } from "../src/lib/server/storage/migrate";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const r2 = r2Settings(Env.parse(process.env));
  const report = await migrateUploadsToR2({ db: prisma, local: localStorage(), r2, dryRun });

  console.log(dryRun ? "[dry-run] R2 には書き込んでいません" : "R2 へのコピーが終わりました");
  console.log(`対象 ${report.total} 件`);
  console.log(`${dryRun ? "コピーする" : "コピーした"} ${report.copied} 件`);
  console.log(`R2 にあるので飛ばした ${report.skipped} 件`);
  console.log(`ローカルに無い ${report.missing.length} 件`);
  for (const name of report.missing) console.log(`  - ${name}`);
  console.log(`R2 にサイズの違うものがある ${report.mismatched.length} 件（上書きしていません）`);
  for (const key of report.mismatched) console.log(`  - ${key}`);
  if (report.mismatched.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
