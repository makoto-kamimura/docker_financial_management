/**
 * D-5d-2 結合テスト（実 DB 使用）
 *
 * 目的: postIssueRecord() が、売掛金/買掛金科目（1300/3000）への直接書き込み（既存挙動）に加えて
 *       監査証跡の複式仕訳（Dr 売掛金/Cr 売上高、Dr 仕入高/Cr 買掛金）を作成すること、
 *       かつその仕訳の P/L 側（売上高/仕入高）が FinancialRecord へは同期されない
 *       （発生主義の収益/費用認識はスコープ外という決定）ことを検証する。
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import {
  postIssueRecord,
  AR_ACCOUNT_CODE,
  AP_ACCOUNT_CODE,
  DEFAULT_RECEIVABLE_REVENUE_ACCOUNT_CODE,
  DEFAULT_PAYABLE_EXPENSE_ACCOUNT_CODE,
} from "@/lib/settlement";

const SUFFIX = `d5d2_${Date.now()}`;

let tenantId: number;
let arAccountId: number;
let apAccountId: number;
let revenueAccountId: number;
let expenseAccountId: number;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: `D5D2_${SUFFIX}` } });
  tenantId = tenant.id;

  const [ar, ap, revenue, expense] = await Promise.all([
    prisma.account.create({
      data: { tenantId, code: AR_ACCOUNT_CODE, name: "売掛金", category: "ASSET" },
    }),
    prisma.account.create({
      data: { tenantId, code: AP_ACCOUNT_CODE, name: "買掛金", category: "LIABILITY" },
    }),
    prisma.account.create({
      data: {
        tenantId,
        code: DEFAULT_RECEIVABLE_REVENUE_ACCOUNT_CODE,
        name: "売上高",
        category: "REVENUE",
      },
    }),
    prisma.account.create({
      data: {
        tenantId,
        code: DEFAULT_PAYABLE_EXPENSE_ACCOUNT_CODE,
        name: "仕入高",
        category: "COGS",
      },
    }),
  ]);
  arAccountId = ar.id;
  apAccountId = ap.id;
  revenueAccountId = revenue.id;
  expenseAccountId = expense.id;
});

afterAll(async () => {
  if (!tenantId) return;
  await prisma.financialRecordHistory.deleteMany({ where: { record: { tenantId } } });
  await prisma.financialRecord.deleteMany({ where: { tenantId } });
  await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.period.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("postIssueRecord (D-5d-2)", () => {
  it("売掛金発生: 1300 へ直接書き込みつつ、Dr 売掛金/Cr 売上高の監査証跡仕訳を作る。売上高側は FinancialRecord に同期しない", async () => {
    const db = tenantDb(tenantId);
    const issueDate = new Date("2026-07-01");

    await postIssueRecord(db, tenantId, "receivable", issueDate, 10000);

    const arRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: arAccountId },
    });
    expect(arRecords).toHaveLength(1);
    expect(Number(arRecords[0].amount)).toBe(10000);
    expect(arRecords[0].journalEntryId).toBeNull(); // 従来どおり単側直接書き込み（choke-point 経由ではない）

    const entry = await prisma.journalEntry.findFirst({
      where: { tenantId, description: "売掛金発生（自動仕訳）" },
      include: { details: { orderBy: { side: "asc" } } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.details.map((d) => [d.side, d.accountId, Number(d.amount)])).toEqual([
      ["credit", revenueAccountId, 10000],
      ["debit", arAccountId, 10000],
    ]);

    // 監査証跡の仕訳は choke-point 同期を呼ばない = 売上高側の FinancialRecord は作られない
    const revenueRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: revenueAccountId },
    });
    expect(revenueRecords).toHaveLength(0);
  });

  it("買掛金発生: 3000 へ直接書き込みつつ、Dr 仕入高/Cr 買掛金の監査証跡仕訳を作る。仕入高側は FinancialRecord に同期しない", async () => {
    const db = tenantDb(tenantId);
    const issueDate = new Date("2026-07-02");

    await postIssueRecord(db, tenantId, "payable", issueDate, 4000);

    const apRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: apAccountId },
    });
    expect(apRecords).toHaveLength(1);
    expect(Number(apRecords[0].amount)).toBe(4000);

    const entry = await prisma.journalEntry.findFirst({
      where: { tenantId, description: "買掛金発生（自動仕訳）" },
      include: { details: { orderBy: { side: "asc" } } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.details.map((d) => [d.side, d.accountId, Number(d.amount)])).toEqual([
      ["credit", apAccountId, 4000],
      ["debit", expenseAccountId, 4000],
    ]);

    const expenseRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: expenseAccountId },
    });
    expect(expenseRecords).toHaveLength(0);
  });

  it("科目が未整備のテナントでは何もしない（AR/AP 科目なし）", async () => {
    const emptyTenant = await prisma.tenant.create({ data: { name: `D5D2_empty_${SUFFIX}` } });
    try {
      const db = tenantDb(emptyTenant.id);
      await expect(
        postIssueRecord(db, emptyTenant.id, "receivable", new Date("2026-07-03"), 1000),
      ).resolves.toBeUndefined();

      const records = await prisma.financialRecord.findMany({
        where: { tenantId: emptyTenant.id },
      });
      expect(records).toHaveLength(0);
    } finally {
      await prisma.tenant.delete({ where: { id: emptyTenant.id } });
    }
  });
});
