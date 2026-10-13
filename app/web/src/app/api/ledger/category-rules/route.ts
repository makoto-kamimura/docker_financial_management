import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, notFound } from "@/lib/server/api-error";
import { normalizeKeyword } from "@/lib/ledger/banktxn-import";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { isValidBusinessRatio } from "@/lib/shared/business-use";

// 学習ルール（txn_category_rules）の一覧と変更。実績管理の「設定」タブから使う。
// 摘要のキーワード（部分一致）→ 科目のルールで、明細に科目を付けたときに覚え（lib/ledger/ledger-categorize.ts）、
// CSV の取り込み・自動取得・「まとめて自動処理」などで使う（lib/ledger/ledger-entries.ts の loadRuleClassifier）。
// ルールを変えても、すでに付いている明細の科目は変えない（付け直すのは実績の確定タブの「科目を付け直す」）。
// ルールは事業利用も持てる（businessUse: true = 事業利用・按分 businessRatio、false = 事業利用なし、
// null = ルールでは決めない）。

/** ルールに付けられる科目の区分（明細に付けられる収入・支出の科目） */
const RULE_CATEGORIES = ["REVENUE", "COGS", "EXPENSE"] as const;

const ItemSchema = z.object({
  /** 既存のルールの id（省略 = 新規） */
  id: z.number().int().positive().optional(),
  keyword: z.string().max(200),
  categoryAccountId: z.number().int().positive(),
  /** 省略 = 今の設定のまま（新規は「決めない」） */
  businessUse: z.boolean().nullable().optional(),
  /** businessUse が true のときの按分（%）。省略すると 100% */
  businessRatio: z
    .number()
    .refine(isValidBusinessRatio, "按分は 0 より大きく 100 以下（小数 2 桁まで）で指定してください")
    .nullable()
    .optional(),
});

const PutSchema = z.object({
  items: z.array(ItemSchema).max(1000),
  /** 一覧から外す既存のルールの id（省略時は削除なし） */
  removedIds: z.array(z.number().int().positive()).max(1000).optional(),
});

async function loadRules(db: TenantDbClient, tenantId: number) {
  const rows = await db.txnCategoryRule.findMany({
    where: { tenantId },
    orderBy: [{ keyword: "asc" }, { id: "asc" }],
    select: {
      id: true,
      keyword: true,
      priority: true,
      businessUse: true,
      businessRatio: true,
      updatedAt: true,
      categoryAccount: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          soleName: true,
          corporateName: true,
        },
      },
    },
  });
  return rows.map((r) => ({
    ...r,
    businessRatio: r.businessRatio === null ? null : Number(r.businessRatio),
  }));
}

// GET /api/ledger/category-rules … 学習ルールの一覧（キーワードの順）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    return NextResponse.json({ data: await loadRules(db, user.tenantId) });
  },
});

// PUT /api/ledger/category-rules … 学習ルールの一括保存（editor 以上）
//   items は画面の一覧（id ありは変更、id なしは追加）、removedIds は消すルール。
//   キーワードは覚えるときと同じく正規化して保存する（normalizeKeyword）。空や重複は 400。
//   画面で足したルールは、明細に科目を付けて覚えたルールと同じ優先度（100）にする。
export const PUT = withApi({
  role: "editor",
  schema: PutSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const removed = new Set(body.removedIds ?? []);
    const items = body.items
      .filter((i) => i.id === undefined || !removed.has(i.id))
      .map((i) => ({ ...i, keyword: normalizeKeyword(i.keyword) }));

    // 事業利用の列。省略された行は既存の値のまま（下で既存の行と合わせる）
    const businessOf = (i: (typeof items)[number]) =>
      i.businessUse === undefined
        ? undefined
        : i.businessUse === true
          ? { businessUse: true, businessRatio: i.businessRatio ?? 100 }
          : { businessUse: i.businessUse, businessRatio: null };

    if (items.some((i) => i.keyword === "")) throw badRequest("キーワードが空のルールがあります");

    // 科目は自テナントの収入・支出の科目だけ
    const accountIds = [...new Set(items.map((i) => i.categoryAccountId))];
    const accounts = await db.account.findMany({
      where: { tenantId, id: { in: accountIds } },
      select: { id: true, category: true },
    });
    if (accounts.length !== accountIds.length) throw notFound("科目が見つかりません");
    if (accounts.some((a) => !(RULE_CATEGORIES as readonly string[]).includes(a.category))) {
      throw badRequest("学習ルールに付けられるのは、収入・支出の科目だけです");
    }

    // 既存のルール（他テナントの id は見つからないものとして扱う）
    const existing = await db.txnCategoryRule.findMany({
      where: { tenantId },
      select: {
        id: true,
        keyword: true,
        categoryAccountId: true,
        businessUse: true,
        businessRatio: true,
      },
    });
    const existingById = new Map(existing.map((r) => [r.id, r]));
    const existingIds = new Set(existingById.keys());
    for (const i of items) {
      if (i.id !== undefined && !existingIds.has(i.id)) throw notFound("ルールが見つかりません");
    }

    // 保存後のキーワードが重ならないこと（画面に出していない既存のルールも含めて見る）
    const sentIds = new Set(items.flatMap((i) => (i.id === undefined ? [] : [i.id])));
    const finalKeywords = [
      ...existing.filter((r) => !removed.has(r.id) && !sentIds.has(r.id)).map((r) => r.keyword),
      ...items.map((i) => i.keyword),
    ];
    const seen = new Set<string>();
    for (const k of finalKeywords) {
      if (seen.has(k)) throw badRequest(`同じキーワードのルールが 2 つあります: ${k}`);
      seen.add(k);
    }

    await db.$transaction(async (tx) => {
      if (removed.size > 0) {
        await tx.txnCategoryRule.deleteMany({ where: { tenantId, id: { in: [...removed] } } });
      }
      // 変えた行だけ書き換える（変えていない行の更新日は動かさない）。
      // キーワードを入れ替えたとき一意制約に当たらないよう、変える行のキーワードをいったん外す
      // （正規化したキーワードは英字が大文字なので、小文字を含む仮の値とは重ならない）
      const businessChanged = (i: (typeof items)[number]) => {
        const next = businessOf(i);
        if (next === undefined) return false;
        const before = existingById.get(i.id!)!;
        const beforeRatio = before.businessRatio === null ? null : Number(before.businessRatio);
        return before.businessUse !== next.businessUse || beforeRatio !== next.businessRatio;
      };
      const updates = items.filter((i) => {
        if (i.id === undefined) return false;
        const before = existingById.get(i.id)!;
        return (
          before.keyword !== i.keyword ||
          before.categoryAccountId !== i.categoryAccountId ||
          businessChanged(i)
        );
      });
      for (const i of updates) {
        await tx.txnCategoryRule.update({
          where: { id: i.id!, tenantId },
          data: { keyword: `__renaming_${i.id}` },
        });
      }
      for (const i of updates) {
        await tx.txnCategoryRule.update({
          where: { id: i.id!, tenantId },
          data: {
            keyword: i.keyword,
            categoryAccountId: i.categoryAccountId,
            ...businessOf(i),
          },
        });
      }
      for (const i of items.filter((x) => x.id === undefined)) {
        await tx.txnCategoryRule.create({
          data: {
            tenantId,
            keyword: i.keyword,
            categoryAccountId: i.categoryAccountId,
            priority: 100,
            ...businessOf(i),
          },
        });
      }
    });

    await audit("update", `category-rules:${items.length}`, {
      after: { saved: items.length, removed: removed.size },
    });
    return NextResponse.json({ data: await loadRules(db, tenantId) });
  },
});
