import { badRequest, notFound } from "@/lib/server/api-error";
import { assertActualsPeriodsEditable, confirmedActualsPeriodIds } from "@/lib/budget/budget-lock";
import { normalizeKeyword } from "@/lib/ledger/banktxn-import";
import { entryActualAmount, UNPAIRED } from "@/lib/ledger/ledger-entries";
import type { TenantDb } from "@/lib/server/tenant-db";

// 明細への科目の紐付け（PATCH /api/bank-transactions/[id]/categorize と
// PATCH /api/card-transactions/[id]/categorize の共通部分）。
//
// 明細は実績の表（financial_records）の 1 行なので、科目を付けた時点でその行が実績になる（転記の操作は無い）。
// 科目を付ける・変える・外すときは、科目（accountId）と実績の金額（amount）を一緒に直す。
// 科目を付けたときは、同じ摘要でまだ未割り当ての同じ種別の明細にも同じ科目を付ける。
// 実績を確定済みの月の明細は変えられない（広げる先からも外す）。

export type CategorizeInput = {
  categoryAccountId?: number | null;
  learn?: boolean;
};

export async function categorizeEntry(
  db: TenantDb,
  ctx: { tenantId: number },
  kind: "BANK" | "CARD" | "CASH",
  id: number,
  body: CategorizeInput,
) {
  const { tenantId } = ctx;
  const txn = await db.financialRecord.findFirst({ where: { id, kind } });
  if (!txn) throw notFound();

  // 口座間振替（transferGroupId を持つ 2 行）は自己資金の移動であり収入・支出ではない。
  if (txn.transferGroupId) {
    throw badRequest("口座間振替の明細は科目を付けられません");
  }
  // デビット・プリペイド・電子マネーへのチャージも同じく資金の移動であり、
  // 実際の支出はチャージ先の利用明細で計上される（chargeGroupId はチャージ元の明細と
  // 対にした入金側にも付く。入金を収入として数えると二重に効いてしまう）。
  if (txn.chargeToCardId || txn.chargeGroupId) {
    throw badRequest("チャージ（資金移動）の明細は科目を付けられません");
  }
  await assertActualsPeriodsEditable(db, [txn.periodId]);

  let category: { id: number; category: string } | null = null;
  if (body.categoryAccountId === undefined) {
    category = txn.accountId
      ? await db.account.findUniqueOrThrow({
          where: { id: txn.accountId },
          select: { id: true, category: true },
        })
      : null;
  } else if (body.categoryAccountId !== null) {
    category = await db.account.findUnique({
      where: { id: body.categoryAccountId, tenantId },
      select: { id: true, category: true },
    });
    if (!category) throw notFound("科目が見つかりません");
  }

  const before = { categoryAccountId: txn.accountId, amount: Number(txn.amount) };
  const actual = (flow: unknown) =>
    category ? entryActualAmount(category.category, Number(flow)) : 0;

  let updatedSiblingCount = 0;

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.financialRecord.update({
      where: { id },
      data: { accountId: category?.id ?? null, amount: actual(txn.flow) },
    });

    if (category === null) return row;

    // 学習ルールは銀行・カードで共有する（TxnCategoryRule はテナント単位のキーワードルールのため）
    if (body.learn) {
      const keyword = normalizeKeyword(txn.description ?? "");
      await tx.txnCategoryRule.upsert({
        where: { tenantId_keyword: { tenantId, keyword } },
        update: { categoryAccountId: category.id, priority: 100 },
        create: { tenantId, keyword, categoryAccountId: category.id, priority: 100 },
      });
    }

    // 同じ摘要でまだ未割り当ての、同じ種別（銀行どうし・カードどうし）の明細にも同じ科目を付ける
    // （学習ルールと同じ正規化で摘要を比べる。確定済みの月の明細は変えない）
    const normalizedDesc = normalizeKeyword(txn.description ?? "");
    const untagged = await tx.financialRecord.findMany({
      where: { kind, accountId: null, id: { not: id }, ...UNPAIRED },
      select: { id: true, description: true, flow: true, periodId: true },
    });
    const sameDesc = untagged.filter(
      (s) => normalizeKeyword(s.description ?? "") === normalizedDesc,
    );
    const locked = await confirmedActualsPeriodIds(
      tx,
      sameDesc.map((s) => s.periodId),
    );
    for (const s of sameDesc) {
      if (locked.has(s.periodId)) continue;
      await tx.financialRecord.update({
        where: { id: s.id },
        data: { accountId: category.id, amount: actual(s.flow) },
      });
      updatedSiblingCount++;
    }
    return row;
  });

  return { before, updated, updatedSiblingCount };
}
