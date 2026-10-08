import { badRequest, conflict, notFound } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";
import { assertActualsPeriodsEditable } from "@/lib/budget-lock";
import { normalizeKeyword } from "@/lib/banktxn-import";
import {
  JOURNAL_DETAILS_INCLUDE,
  signedActualAmountFromSpend,
  syncJournalToFinancialRecords,
} from "@/lib/journal";
import type { TenantDb } from "@/lib/tenant-db";

// 明細への科目紐付け・実績転記（PATCH /api/bank-transactions/[id]/categorize と
// PATCH /api/card-transactions/[id]/categorize の共通部分）。
//
// 明細の金額は種別によらず +入金 / −出金なので、銀行とカードの違いは
// 「仕訳の相手になる口座の科目」（銀行は ASSET、カードは LIABILITY）と支払方法の名前だけ。

export type CategorizeInput = {
  categoryAccountId?: number | null;
  post?: boolean;
  learn?: boolean;
};

export async function categorizeEntry(
  db: TenantDb,
  ctx: { tenantId: number; userId: number },
  kind: "BANK" | "CARD",
  id: number,
  body: CategorizeInput,
) {
  const { tenantId } = ctx;
  const txn = await db.ledgerEntry.findFirst({ where: { id, kind } });
  if (!txn) throw notFound();

  // 口座間振替（transferGroupId を持つ 2 行）は自己資金の移動であり収入・支出ではない。
  // 科目に紐付けると資金フロー図・実績で二重計上されるため、紐付けも転記も受け付けない。
  if (txn.transferGroupId) {
    throw badRequest("口座間振替の明細は科目紐付け・実績転記の対象外です");
  }
  // デビット・プリペイド・電子マネーへのチャージも同じく資金の移動であり、
  // 実際の支出はチャージ先の利用明細で計上される（chargeGroupId はチャージ元の明細と
  // 対にした入金側にも付く。入金を収入として計上すると二重に効いてしまう）。
  if (txn.chargeToCardId || txn.chargeGroupId) {
    throw badRequest("チャージ（資金移動）の明細は科目紐付け・実績転記の対象外です");
  }

  let categoryAccountId = txn.categoryAccountId;
  if (body.categoryAccountId !== undefined) {
    if (body.categoryAccountId === null) {
      categoryAccountId = null;
    } else {
      const account = await db.account.findUnique({
        where: { id: body.categoryAccountId, tenantId },
      });
      if (!account) throw notFound("科目が見つかりません");
      categoryAccountId = account.id;
    }
  }

  const before = {
    categoryAccountId: txn.categoryAccountId,
    postedRecordId: txn.postedRecordId,
  };

  // post 前提の期間解決は $transaction の外で行う（period.upsert は冪等なため安全）
  const period = body.post ? await resolvePeriodForDate(db, tenantId, txn.date) : null;
  // 実績確定済みの月へは転記しない（科目の紐付けだけなら受け付ける）
  if (period) await assertActualsPeriodsEditable(db, [period.id]);

  let updatedSiblingCount = 0;

  const updated = await db.$transaction(async (tx) => {
    await tx.ledgerEntry.update({ where: { id }, data: { categoryAccountId } });

    // 学習ルールは銀行・カードで共有する（TxnCategoryRule はテナント単位のキーワードルールのため）
    if (body.learn && categoryAccountId !== null) {
      const keyword = normalizeKeyword(txn.description);
      await tx.txnCategoryRule.upsert({
        where: { tenantId_keyword: { tenantId, keyword } },
        update: { categoryAccountId, priority: 100 },
        create: { tenantId, keyword, categoryAccountId, priority: 100 },
      });
    }

    if (body.post) {
      if (txn.postedRecordId) throw conflict("既に転記済みです");
      if (categoryAccountId === null) throw conflict("科目が未設定のため転記できません");

      // 転記時、同一摘要でまだ科目が未設定の同じ種別（銀行どうし・カードどうし）の明細にも
      // 同じ科目を一括で適用する（学習ルールと同じ正規化で摘要を比較する）。
      const normalizedDesc = normalizeKeyword(txn.description);
      const untaggedSiblings = await tx.ledgerEntry.findMany({
        where: { kind, categoryAccountId: null, id: { not: id } },
        select: { id: true, description: true },
      });
      const siblingIds = untaggedSiblings
        .filter((s) => normalizeKeyword(s.description) === normalizedDesc)
        .map((s) => s.id);
      if (siblingIds.length > 0) {
        await tx.ledgerEntry.updateMany({
          where: { id: { in: siblingIds } },
          data: { categoryAccountId },
        });
        updatedSiblingCount = siblingIds.length;
      }

      // 仕訳明細の金額は借方・貸方の入れ替えで向きを表すため常に正で持つ
      const amount = Math.abs(Number(txn.amount));

      // D-5d: 口座・カードに勘定科目（銀行は ASSET、カードは LIABILITY）が紐付いており、
      // かつ分類科目が P/L 科目なら複式仕訳を作って choke-point 経由で同期する（試算表・総勘定元帳にも計上される）。
      // 未紐付け、または分類科目が B/S 科目の場合は従来どおりの単側直接書き込みに留める
      // （B/S 科目はスナップショット意味論のため choke-point の対象外 — 再設計詳細設計書.md §12.3）。
      const [ledgerAccount, categoryAccount] = await Promise.all([
        kind === "BANK"
          ? tx.bankAccount.findUnique({ where: { id: txn.bankAccountId! } })
          : tx.linkedAccount.findUnique({ where: { id: txn.cardAccountId! } }),
        tx.account.findUnique({ where: { id: categoryAccountId } }),
      ]);
      const ledgerAccountId = ledgerAccount?.accountId ?? null;
      const canJournalize =
        ledgerAccountId !== null &&
        categoryAccount != null &&
        categoryAccount.category !== "ASSET" &&
        categoryAccount.category !== "LIABILITY";

      // 仕訳を経由しない直接転記の金額。明細は出金が負なので「支出が正」へ直して渡す。
      // 収入科目に紐付いた出金（受け取った仕送りの返金など）はマイナスの収入、
      // 費用科目に紐付いた入金（カードの返金など）はマイナスの費用として計上され、同じ月の分と相殺される。
      const recordAmount = categoryAccount
        ? signedActualAmountFromSpend(categoryAccount.category, -Number(txn.amount))
        : amount;

      let record: { id: number };
      if (canJournalize) {
        // 入金（銀行の入金・カードの返金）: 借方 口座・カードの科目 ／ 貸方 分類科目。
        // 出金（銀行の出金・カードの利用）: 借方 分類科目 ／ 貸方 口座・カードの科目。
        const isIncome = Number(txn.amount) > 0;
        const [debitId, creditId] = isIncome
          ? [ledgerAccountId, categoryAccountId]
          : [categoryAccountId, ledgerAccountId];

        const entry = await tx.journalEntry.create({
          data: {
            tenantId,
            transactionDate: txn.date,
            description: txn.description,
            paymentMethod: kind === "BANK" ? "bank" : "card",
            taxCategory: "taxable",
            details: {
              create: [
                { side: "debit", accountId: debitId, amount },
                { side: "credit", accountId: creditId, amount },
              ],
            },
          },
          include: JOURNAL_DETAILS_INCLUDE,
        });
        await syncJournalToFinancialRecords(
          tx,
          tenantId,
          entry.id,
          entry.transactionDate,
          entry.details.map((d) => ({
            accountId: d.accountId,
            category: d.account.category,
            side: d.side,
            amount: Number(d.amount),
          })),
        );
        record = await tx.financialRecord.findFirstOrThrow({
          where: { journalEntryId: entry.id },
        });
      } else {
        record = await tx.financialRecord.create({
          data: {
            tenantId,
            accountId: categoryAccountId,
            periodId: period!.id,
            amount: recordAmount,
          },
        });
      }

      await tx.financialRecordHistory.create({
        data: {
          recordId: record.id,
          userId: ctx.userId,
          action: "create",
          amount: canJournalize ? amount : recordAmount,
        },
      });

      // postedRecordId が null のままの行だけを対象にした条件付き更新。並行リクエストで
      // 相手が先に成功していれば 0 件更新となり、@unique 制約と合わせて二重転記を防ぐ。
      const claim = await tx.ledgerEntry.updateMany({
        where: { id, postedRecordId: null },
        data: { postedRecordId: record.id },
      });
      if (claim.count === 0) throw conflict("既に転記済みです");
    }

    return tx.ledgerEntry.findUniqueOrThrow({ where: { id } });
  });

  return { before, updated, updatedSiblingCount };
}
