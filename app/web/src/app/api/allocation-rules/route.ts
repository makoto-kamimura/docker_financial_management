import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { loadAllocationRulesView } from "@/lib/budget/allocation-data";
import {
  ALLOCATION_GROUPS,
  ALLOCATION_TARGET_CATEGORIES,
} from "@/lib/budget/default-allocation-rules";

const RuleSchema = z
  .object({
    key: z.string().min(1).max(50),
    label: z.string().min(1).max(100),
    group: z.enum(ALLOCATION_GROUPS),
    minPercent: z.number().min(0).max(100),
    maxPercent: z.number().min(0).max(100).nullable(),
    note: z.string().max(255).nullable().optional(),
    // 科目名にこのどれかを含む科目をこのルールに入れる（lib/shared/allocation-assign.ts）
    keywords: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
    // キーワードに当たらなかったこの区分の科目を受け取る（受け皿）。null = 受け皿ではない
    fallbackCategory: z.enum(ALLOCATION_TARGET_CATEGORIES).nullable().optional(),
  })
  .refine((r) => r.maxPercent === null || r.minPercent <= r.maxPercent, {
    message: "minPercent は maxPercent 以下にしてください",
  });

const PutSchema = z.object({
  items: z.array(RuleSchema).min(1).max(100),
  /** 一覧から外す既存ルールの key（省略時は削除なし） */
  removedKeys: z.array(z.string()).max(100).optional(),
});

// GET /api/allocation-rules … 予算配分ルール一覧（テナント別マスタ）
//   ルールごとのメンバー科目（自動の振り分けと手動の割り当てを解決したもの）と、
//   どのルールにも入っていない科目も返す。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const view = await loadAllocationRulesView(db, user.tenantId);
    return NextResponse.json({ data: view.rules, unassigned: view.unassigned });
  },
});

// PUT /api/allocation-rules … 予算配分ルールの一括更新（key 単位の upsert + 任意削除、editor 以上）
//   科目はルールに直接結び付けない。キーワードと受け皿の区分を変えると、振り分けがその場で変わる。
//   ルールを消すと、そのルールへの手動の割り当ても消え（FK の CASCADE）、科目は自動に戻る。
export const PUT = withApi({
  role: "editor",
  schema: PutSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;

    await db.$transaction(async (tx) => {
      for (const [index, item] of body.items.entries()) {
        const common = {
          label: item.label,
          group: item.group,
          minPercent: item.minPercent,
          maxPercent: item.maxPercent,
          note: item.note ?? null,
          sortOrder: index,
          ...(item.keywords !== undefined ? { keywords: item.keywords } : {}),
          ...(item.fallbackCategory !== undefined
            ? { fallbackCategory: item.fallbackCategory }
            : {}),
        };
        await tx.allocationRule.upsert({
          where: { tenantId_key: { tenantId, key: item.key } },
          update: common,
          create: { tenantId, key: item.key, ...common },
        });
      }
      if (body.removedKeys?.length) {
        await tx.allocationRule.deleteMany({
          where: { tenantId, key: { in: body.removedKeys } },
        });
      }
    });

    await audit("update", `allocation-rules:${body.items.length}`);

    const view = await loadAllocationRulesView(db, tenantId);
    return NextResponse.json({ data: view.rules, unassigned: view.unassigned });
  },
});
