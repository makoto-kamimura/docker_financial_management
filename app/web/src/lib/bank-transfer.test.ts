import { describe, expect, it } from "vitest";
import { BankTransferCreateSchema, buildTransferPair } from "./bank-transfer";

const base = {
  date: "2026-08-07",
  fromAccountId: 1,
  toAccountId: 2,
  amount: 50000,
};

describe("BankTransferCreateSchema", () => {
  it("摘要なしでも通る", () => {
    expect(BankTransferCreateSchema.safeParse(base).success).toBe(true);
  });

  it("出金元と入金先が同じなら弾く", () => {
    const r = BankTransferCreateSchema.safeParse({ ...base, toAccountId: 1 });
    expect(r.success).toBe(false);
  });

  it("金額 0 以下は弾く", () => {
    expect(BankTransferCreateSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(BankTransferCreateSchema.safeParse({ ...base, amount: -100 }).success).toBe(false);
  });
});

describe("buildTransferPair", () => {
  it("出金元に −amount、入金先に +amount の 2 行を作る", () => {
    const [out, income] = buildTransferPair(base, "g-1");
    expect(out.accountId).toBe(1);
    expect(out.amount).toBe(-50000);
    expect(income.accountId).toBe(2);
    expect(income.amount).toBe(50000);
    // 対で消せるよう同じグループ ID を持つ
    expect(out.transferGroupId).toBe("g-1");
    expect(income.transferGroupId).toBe("g-1");
    // 合計は 0（テナント全体の残高は増減しない）
    expect(out.amount + income.amount).toBe(0);
  });

  it("摘要未入力なら相手口座名から自動で組み立てる", () => {
    const [out, income] = buildTransferPair(base, "g-1", {
      fromName: "住信SBI",
      toName: "みずほ",
    });
    expect(out.description).toBe("みずほ へ振替");
    expect(income.description).toBe("住信SBI から振替");
  });

  it("摘要を入力したら両方の行に使う", () => {
    const [out, income] = buildTransferPair({ ...base, description: " 生活費の移動 " }, "g-1");
    expect(out.description).toBe("生活費の移動");
    expect(income.description).toBe("生活費の移動");
  });

  it("金額の符号は入力に依らず出金元が負になる", () => {
    const [out, income] = buildTransferPair({ ...base, amount: 30000 }, "g-1");
    expect(out.amount).toBeLessThan(0);
    expect(income.amount).toBeGreaterThan(0);
  });
});
