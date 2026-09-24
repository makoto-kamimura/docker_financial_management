import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryRank,
  LOAN_TYPE_LABEL,
  LOAN_TYPES,
  PERSONAL_ASSET_CATEGORY_LABEL,
} from "./labels";
import { KPI_LABELS, MODE_LABELS } from "./mode-labels";
import { ACCOUNT_CATEGORIES } from "./account-category";
import { PERSONAL_ASSET_CATEGORIES } from "./personal-asset";

describe("labels", () => {
  it("勘定科目の区分はすべて並び順と表示名を持つ", () => {
    for (const c of ACCOUNT_CATEGORIES) {
      expect(CATEGORY_ORDER).toContain(c);
      expect(CATEGORY_LABEL[c]).toBeTruthy();
    }
  });

  it("categoryRank は CATEGORY_ORDER の順位で、未知の区分は末尾", () => {
    expect(categoryRank("ASSET")).toBe(0);
    expect(categoryRank("REVENUE")).toBeLessThan(categoryRank("EXPENSE"));
    expect(categoryRank("UNKNOWN")).toBe(CATEGORY_ORDER.length);
  });

  it("実物資産の種別はすべて表示名を持つ", () => {
    for (const c of PERSONAL_ASSET_CATEGORIES)
      expect(PERSONAL_ASSET_CATEGORY_LABEL[c]).toBeTruthy();
  });

  it("借入種別の表示名に実物資産の負債（asset）を含むが、選択肢には出さない", () => {
    expect(LOAN_TYPE_LABEL.asset).toBe("実物資産の負債");
    expect(LOAN_TYPES.map((t) => t.value)).not.toContain("asset");
  });
});

describe("KPI_LABELS", () => {
  it("個人・法人は資金フロー図と同じ用語", () => {
    expect(KPI_LABELS.sole.revenue).toBe(MODE_LABELS.sole.revenue);
    expect(KPI_LABELS.sole.profit).toBe(MODE_LABELS.sole.operatingProfit);
    expect(KPI_LABELS.corporate.grossProfit).toBe("売上総利益");
    expect(KPI_LABELS.corporate.profitRate).toBe("営業利益率");
  });

  it("家計は貯蓄の言葉で見せる", () => {
    expect(KPI_LABELS.household.profit).toBe("貯蓄額");
    expect(KPI_LABELS.household.profitRate).toBe("貯蓄率");
  });
});
