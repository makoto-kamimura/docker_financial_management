import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";

const GROUPS = ["固定費", "生活費", "その他"] as const;

const RuleSchema = z
  .object({
    key: z.string().min(1).max(50),
    label: z.string().min(1).max(100),
    group: z.enum(GROUPS),
    minPercent: z.number().min(0).max(100),
    maxPercent: z.number().min(0).max(100).nullable(),
    note: z.string().max(255).nullable().optional(),
    accountCode: z.string().nullable().optional(), // 対応科目コード（null = 紐付け解除）
  })
  .refine((r) => r.maxPercent === null || r.minPercent <= r.maxPercent, {
    message: "minPercent は maxPercent 以下にしてください",
  });

const PutSchema = z.object({
  items: z.array(RuleSchema).min(1).max(100),
  /** 一覧から外す既存ルールの key（省略時は削除なし） */
  removedKeys: z.array(z.string()).max(100).optional(),
});

// ルール行を API レスポンス形式へ整形（Decimal → number）
function serialize(rule: {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: unknown;
  maxPercent: unknown;
  note: string | null;
  sortOrder: number;
  account: { id: number; code: string; name: string } | null;
}) {
  return {
    id: rule.id,
    key: rule.key,
    label: rule.label,
    group: rule.group,
    minPercent: Number(rule.minPercent),
    maxPercent: rule.maxPercent === null ? null : Number(rule.maxPercent),
    note: rule.note,
    sortOrder: rule.sortOrder,
    account: rule.account,
  };
}

const RULE_INCLUDE = { account: { select: { id: true, code: true, name: true } } };

// GET /api/allocation-rules … 予算配分ルール一覧（テナント別マスタ）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const rules = await db.allocationRule.findMany({
      where: { tenantId: user.tenantId },
      include: RULE_INCLUDE,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ data: rules.map(serialize) });
  },
});

// PUT /api/allocation-rules … 予算配分ルールの一括更新（key 単位の upsert + 任意削除、editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: PutSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;

    // 科目コードを事前解決（自テナントの科目のみ許可）
    const accountIdByKey = new Map<string, number | null>();
    for (const item of body.items) {
      if (item.accountCode === undefined) continue;
      if (item.accountCode === null || item.accountCode === "") {
        accountIdByKey.set(item.key, null);
        continue;
      }
      const account = await findAccountByCode(db, tenantId, item.accountCode);
      if (!account) throw badRequest(`unknown accountCode: ${item.accountCode}`);
      accountIdByKey.set(item.key, account.id);
    }

    await db.$transaction(async (tx) => {
      for (const [index, item] of body.items.entries()) {
        const accountId = accountIdByKey.get(item.key);
        await tx.allocationRule.upsert({
          where: { tenantId_key: { tenantId, key: item.key } },
          update: {
            label: item.label,
            group: item.group,
            minPercent: item.minPercent,
            maxPercent: item.maxPercent,
            note: item.note ?? null,
            sortOrder: index,
            ...(accountId !== undefined ? { accountId } : {}),
          },
          create: {
            tenantId,
            key: item.key,
            label: item.label,
            group: item.group,
            minPercent: item.minPercent,
            maxPercent: item.maxPercent,
            note: item.note ?? null,
            accountId: accountId ?? null,
            sortOrder: index,
          },
        });
      }
      if (body.removedKeys?.length) {
        await tx.allocationRule.deleteMany({
          where: { tenantId, key: { in: body.removedKeys } },
        });
      }
    });

    await audit("update", `allocation-rules:${body.items.length}`);

    const rules = await db.allocationRule.findMany({
      where: { tenantId },
      include: RULE_INCLUDE,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ data: rules.map(serialize) });
  },
});
