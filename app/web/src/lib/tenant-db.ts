import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// テナント分離を「仕組み」で強制する Prisma Client Extension。
//
// 各 API ルートで手書きの `where: { tenantId }` に頼る代わりに、
//   const db = tenantDb(auth.user.tenantId);
//   await db.receivable.findMany();          // 自動で where: { tenantId } が付く
//   await db.receivable.create({ data });    // 自動で data.tenantId が付く
// のように使うと、tenantId を書き忘れてもテナント越境が起きない。
//
// 対象は tenantId 列を持つ業務テーブルのみ（ホワイトリスト方式）。
//
// 【User を含めない理由】User は tenantId 列を持つが「テナント所属（メンバーシップ）」
// を表す特殊モデル。admin/users の新規テナント作成フロー（newTenant）では
// 操作者とは別の tenantId を持つ User を作成するため、tenantId を自動注入すると
// その分岐が壊れる。User の絞り込みは呼び出し側で明示的に扱う。
// Session / AuditLog / Tenant / 各種子テーブル（JournalDetail など）は tenantId 列を
// 持たないため、そもそも対象外（注入するとカラム不在で実行時エラーになる）。
//
// 【LearningProgress を含めない理由】学習ガイドの既読管理は userId 所有のユーザー私物
// （F-9）。tenantId 列は持つが、アクセス制御は常に `userId: user.id` で明示的に絞り込む
// べきものであり、tenantId の自動注入では「同テナント内の他ユーザーの既読が見える」
// 誤りを構造的に防げない（User と同じ理由）。
export const TENANT_SCOPE_EXCLUDED_MODELS = new Set<string>(["User", "LearningProgress"]);

// S-10: TENANT_SCOPED_MODELS は Prisma.dmmf から「tenantId 列を持つ全モデル −
// TENANT_SCOPE_EXCLUDED_MODELS」として起動時に自動導出する（手書き Set の登録漏れを
// 構造的に防ぐ）。schema.prisma に tenantId 付きモデルを新規追加した場合、明示的に
// EXCLUDED へ登録しない限り自動的にスコープ対象になる（fail-secure なデフォルト。
// 従来の「登録し忘れると素通しされ、テナント越境の穴になる」という失敗モードを排除する）。
export const TENANT_SCOPED_MODELS = new Set<string>(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId" && f.kind === "scalar"))
    .map((m) => m.name)
    .filter((name) => !TENANT_SCOPE_EXCLUDED_MODELS.has(name)),
);

// tenantId を最後に spread することで、呼び出し側が別テナントの tenantId を
// 明示的に渡してきても必ず上書きし、テナント境界を越えられないようにする。
function scopeWhere(args: { where?: Record<string, unknown> } | undefined, tenantId: number) {
  const base = args ?? {};
  return { ...base, where: { ...(base.where ?? {}), tenantId } };
}

function scopeCreateData(data: unknown, tenantId: number) {
  if (Array.isArray(data)) {
    return data.map((d) => ({ ...(d as Record<string, unknown>), tenantId }));
  }
  return { ...(data as Record<string, unknown>), tenantId };
}

/**
 * 指定テナントに自動スコープされた Prisma クライアントを返す。
 * `$extends` は接続プールを共有したまま安価に拡張クライアントを返すため、
 * リクエストごとに呼び出しても性能問題は出ない。
 */
export function tenantDb(tenantId: number) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          switch (operation) {
            // 読み取り／条件付き更新削除: where に tenantId を注入
            case "findUnique":
            case "findUniqueOrThrow":
            case "findFirst":
            case "findFirstOrThrow":
            case "findMany":
            case "count":
            case "aggregate":
            case "groupBy":
            case "update":
            case "updateMany":
            case "updateManyAndReturn":
            case "delete":
            case "deleteMany":
              return query(scopeWhere(args, tenantId));

            // 生成: data に tenantId を強制
            case "create":
            case "createManyAndReturn":
              return query({ ...args, data: scopeCreateData(args?.data, tenantId) });

            case "createMany":
              return query({ ...args, data: scopeCreateData(args?.data, tenantId) });

            // upsert: 検索条件と新規作成データの両方に tenantId を注入
            case "upsert":
              return query({
                ...args,
                where: { ...(args?.where ?? {}), tenantId },
                create: { ...(args?.create ?? {}), tenantId },
              });

            // 未知の操作（$queryRaw 等はここには来ないが保険）は素通し
            default:
              return query(args);
          }
        },
      },
    },
  });
}

// ルートで型注釈が必要なときのための型エイリアス。
export type TenantDb = ReturnType<typeof tenantDb>;
