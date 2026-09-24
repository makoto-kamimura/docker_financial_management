import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, conflict, notFound } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";
import { normalizeKeyword } from "@/lib/banktxn-import";
import { serializeCardTransaction } from "@/lib/card-transactions";
import {
  JOURNAL_DETAILS_INCLUDE,
  signedActualAmountFromSpend,
  syncJournalToFinancialRecords,
} from "@/lib/journal";

const Schema = z.object({
  categoryAccountId: z.number().int().positive().nullable().optional(),
  post: z.boolean().optional(),
  learn: z.boolean().optional(),
});

// PATCH /api/card-transactions/[id]/categorize … カード明細への科目紐付け・実績転記（editor 以上）
// bank-transactions/[id]/categorize と同構造・同機能（銀行側の実装・挙動は変更しない）。
export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { tenantId } = user;

    // 明細は親口座（LinkedAccount）経由でテナント所有を確認する（他テナント明細は存在ごと秘匿）
    const txn = await db.cardTransaction.findFirst({
      where: { id, account: { tenantId } },
    });
    if (!txn) throw notFound();

    // チャージ（他カード・電子マネーへの資金移動）はそれ自体が支出ではなく、
    // 実際の支出はチャージ先の利用明細で計上される。科目に紐付けると二重計上になるため、
    // 銀行明細の transferGroupId と同じく紐付けも転記も受け付けない。
    // chargeGroupId は「チャージ元の明細と対にした入金側」にも付くため、そちらも対象外にする
    // （チャージによる入金を収入として計上すると、チャージ元と合わせて二重に効いてしまう）。
    if (txn.transferToAccountId || txn.chargeGroupId) {
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

    let updatedSiblingCount = 0;

    const updated = await db.$transaction(async (tx) => {
      await tx.cardTransaction.update({ where: { id }, data: { categoryAccountId } });

      // 学習ルールは銀行明細と共有する（TxnCategoryRule はテナント単位のキーワードルールのため）
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

        // 転記時、同一摘要でまだ科目が未設定の他のカード明細にも同じ科目を一括で適用する
        // （テナント内の全カード口座が対象。学習ルールと同じ正規化で摘要を比較する）。
        const normalizedDesc = normalizeKeyword(txn.description);
        const untaggedSiblings = await tx.cardTransaction.findMany({
          where: { account: { tenantId }, categoryAccountId: null, id: { not: id } },
          select: { id: true, description: true },
        });
        const siblingIds = untaggedSiblings
          .filter((s) => normalizeKeyword(s.description) === normalizedDesc)
          .map((s) => s.id);
        if (siblingIds.length > 0) {
          await tx.cardTransaction.updateMany({
            where: { id: { in: siblingIds } },
            data: { categoryAccountId },
          });
          updatedSiblingCount = siblingIds.length;
        }

        const amount = Math.abs(Number(txn.amount));

        // カードは LinkedAccount に紐付く LIABILITY 科目が貸方（自然増加側）になる点が銀行（ASSET）と逆。
        // 口座に勘定科目（LIABILITY）が紐付いており、かつ分類科目が P/L 科目なら
        // 複式仕訳を作って choke-point 経由で同期する（試算表・総勘定元帳にも計上される）。
        // 口座が未紐付け、または分類科目が B/S 科目の場合は従来どおりの単側直接書き込みに留める
        // （B/S 科目はスナップショット意味論のため choke-point の対象外 — 再設計詳細設計書.md §12.3）。
        const [linkedAccount, categoryAccount] = await Promise.all([
          tx.linkedAccount.findUnique({ where: { id: txn.accountId } }),
          tx.account.findUnique({ where: { id: categoryAccountId } }),
        ]);
        const canJournalize =
          linkedAccount?.accountId != null &&
          categoryAccount != null &&
          categoryAccount.category !== "ASSET" &&
          categoryAccount.category !== "LIABILITY";

        // 仕訳を経由しない直接転記の金額。カード明細は利用が正なのでそのまま「支出が正」として渡す。
        // 返金（amount < 0）はマイナス計上になり、同じ月の利用と相殺される
        // （以前は abs で符号を捨てており、返金も費用として積み上がっていた）。
        const recordAmount = categoryAccount
          ? signedActualAmountFromSpend(categoryAccount.category, Number(txn.amount))
          : amount;

        let record: { id: number };
        if (canJournalize) {
          // 利用（amount > 0）: 費用計上＝借方 categoryAccountId／負債増加＝貸方カード科目。
          // 返金（amount < 0）: 逆仕訳（負債減少＝借方カード科目／費用減額＝貸方 categoryAccountId）。
          const isCharge = Number(txn.amount) > 0;
          const [debitId, creditId] = isCharge
            ? [categoryAccountId, linkedAccount!.accountId!]
            : [linkedAccount!.accountId!, categoryAccountId];

          const entry = await tx.journalEntry.create({
            data: {
              tenantId,
              transactionDate: txn.date,
              description: txn.description,
              paymentMethod: "card",
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
            userId: user.id,
            action: "create",
            amount: canJournalize ? amount : recordAmount,
          },
        });

        // postedRecordId が null のままの行だけを対象にした条件付き更新。並行リクエストで
        // 相手が先に成功していれば 0 件更新となり、@unique 制約と合わせて二重転記を防ぐ。
        const claim = await tx.cardTransaction.updateMany({
          where: { id, postedRecordId: null },
          data: { postedRecordId: record.id },
        });
        if (claim.count === 0) throw conflict("既に転記済みです");
      }

      return tx.cardTransaction.findUniqueOrThrow({ where: { id } });
    });

    await audit("card_txn_categorize", `card_transaction:${id}`, {
      before,
      after: {
        categoryAccountId: updated.categoryAccountId,
        postedRecordId: updated.postedRecordId,
      },
      ...(updatedSiblingCount > 0 ? { updatedSiblingCount } : {}),
    });

    return NextResponse.json({ data: serializeCardTransaction(updated), updatedSiblingCount });
  },
});
