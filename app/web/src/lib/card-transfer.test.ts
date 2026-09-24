import { describe, expect, it } from "vitest";
import { resolveTransferTarget, validateCardTransferTarget } from "./card-transfer";

describe("resolveTransferTarget", () => {
  const rules = [{ keyword: "ＪＡＬ　Ｐａｙ", transferToAccountId: 7 }];

  it("摘要にキーワードが含まれればチャージ先を返す", () => {
    expect(resolveTransferTarget("[信] ＪＡＬ　Ｐａｙ", rules)).toBe(7);
    // CSV によって付く連番の接尾辞があっても部分一致で拾える
    expect(resolveTransferTarget("[信] ＪＡＬ　Ｐａｙ (12)", rules)).toBe(7);
  });

  it("全角スペースの数や大小文字の違いを吸収する", () => {
    expect(resolveTransferTarget("[信] ＪＡＬ Ｐａｙ", rules)).toBe(7);
    expect(resolveTransferTarget("[信] ＪＡＬ　ＰＡＹ", rules)).toBe(7);
  });

  it("一致しなければ null", () => {
    expect(resolveTransferTarget("セブン−イレブン", rules)).toBeNull();
    expect(resolveTransferTarget("[信] ＪＡＬ　Ｐａｙ", [])).toBeNull();
  });

  it("複数一致した場合はキーワードの長い方を優先する", () => {
    const target = resolveTransferTarget("ＡＭＡＺＯＮ ギフト券チャージ", [
      { keyword: "ＡＭＡＺＯＮ", transferToAccountId: 1 },
      { keyword: "ＡＭＡＺＯＮ ギフト券", transferToAccountId: 2 },
    ]);
    expect(target).toBe(2);
  });
});

describe("validateCardTransferTarget", () => {
  const txn = { id: 1, accountId: 9, description: "[信] ＪＡＬ　Ｐａｙ", postedRecordId: null };

  it("別カードへのチャージなら null", () => {
    expect(validateCardTransferTarget(txn, 7)).toBeNull();
  });

  it("自分自身へのチャージは弾く", () => {
    expect(validateCardTransferTarget(txn, 9)).toContain("同じカード");
  });

  it("転記済みは弾く", () => {
    expect(validateCardTransferTarget({ ...txn, postedRecordId: 5 }, 7)).toContain("転記済み");
  });
});
