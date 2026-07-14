import { NextRequest, NextResponse } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireRole, type Role } from "@/lib/authz";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { writeAudit, type AuditOptions } from "@/lib/audit";
import { errorResponse } from "@/lib/api-error";
import { clientIp } from "@/lib/rate-limit";

export type AuthUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export type ApiContext<TBody, TQuery> = {
  req: NextRequest;
  /** requireRole 済みのログインユーザー（tenantId 含む） */
  user: AuthUser;
  /** tenantDb(user.tenantId) 済みのテナントスコープ付きクライアント */
  db: TenantDb;
  /** schema 指定時のみ: Zod 検証済みリクエストボディ */
  body: TBody;
  /** querySchema 指定時のみ: Zod 検証済みクエリパラメータ */
  query: TQuery;
  /** 動的ルートパラメータ（[filename] 等。id は下の id を使う） */
  params: Record<string, string>;
  /** [id] ルートでのみ有効。正の整数として検証済み（それ以外のルートでは参照しない） */
  id: number;
  /** userId を自動付与した writeAudit */
  audit: (action: string, target: string, options?: AuditOptions) => Promise<void>;
};

type RouteContext = { params: Promise<Record<string, string>> };

// 静的ルート用の空コンテキスト（テストから直接ハンドラを呼ぶときにも使う）
export const emptyRouteContext = (): RouteContext => ({ params: Promise.resolve({}) });

/**
 * Route Handler 共通ラッパー。全ルートで繰り返されていた
 * 「認証 → 認可 → [id] 検証 → 入力検証 → テナント DB 生成 → エラー整形 → 監査」
 * を一箇所に集約する。
 *
 *   export const GET = withApi({
 *     role: "viewer",
 *     querySchema: z.object({ year: z.coerce.number().int().optional() }),
 *     handler: async ({ db, query }) => NextResponse.json({ data: ... }),
 *   });
 *
 * 処理順:
 *   1. requireRole(role)（401 / 403）
 *   2. [id] パラメータの検証（正の整数以外は 400 "invalid id"）
 *   3. schema / querySchema による Zod 検証（失敗は 400 + flatten）
 *   4. handler 実行。throw された ApiError / Prisma エラーは errorResponse が写像
 */
export function withApi<TBody = undefined, TQuery = undefined>(opts: {
  role: Role;
  // Input/Output が異なるスキーマ（.default() / .coerce）でも Output 側で型付けする
  schema?: ZodType<TBody, ZodTypeDef, unknown>;
  querySchema?: ZodType<TQuery, ZodTypeDef, unknown>;
  handler: (ctx: ApiContext<TBody, TQuery>) => Promise<Response>;
}): (req: NextRequest, route: RouteContext) => Promise<Response> {
  // Next.js のルート型検証は第 2 引数を必須型で要求するため、宣言上は必須にし
  // 実装ではランタイムの未指定（直接呼び出し等）にも耐えるようにする。
  return async (req: NextRequest, route?: RouteContext): Promise<Response> => {
    try {
      const auth = await requireRole(opts.role);
      if (auth.error) return auth.error;
      const user = auth.user;

      const params = route?.params ? await route.params : {};

      let id = 0;
      if (params.id !== undefined) {
        id = Number(params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return NextResponse.json({ error: "invalid id" }, { status: 400 });
        }
      }

      let body = undefined as TBody;
      if (opts.schema) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return NextResponse.json({ error: "invalid json body" }, { status: 400 });
        }
        const parsed = opts.schema.safeParse(raw);
        if (!parsed.success) {
          return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
        }
        body = parsed.data;
      }

      let query = undefined as TQuery;
      if (opts.querySchema) {
        const parsed = opts.querySchema.safeParse(
          Object.fromEntries(req.nextUrl.searchParams.entries()),
        );
        if (!parsed.success) {
          return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
        }
        query = parsed.data;
      }

      const db = tenantDb(user.tenantId);
      // S-12: tenantId / ip / userAgent を自動付与する（呼び出し側は action/target/before/after のみ渡せばよい）
      const audit = (action: string, target: string, options?: AuditOptions) =>
        writeAudit(user.id, action, target, {
          ...options,
          tenantId: user.tenantId,
          ip: clientIp(req),
          userAgent: req.headers.get("user-agent"),
        });

      return await opts.handler({ req, user, db, body, query, params, id, audit });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
