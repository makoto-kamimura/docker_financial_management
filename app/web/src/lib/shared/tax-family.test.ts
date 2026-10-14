import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_RULES } from "./tax-rules";
import {
  ageAt,
  isHousingSpecialHousehold,
  judgeFamily,
  judgeMember,
  maxSalaryWithin,
  salaryIncome,
  type FamilyMember,
} from "./tax-family";

const r2025 = DEFAULT_TAX_RULES[2025];
const r2026 = DEFAULT_TAX_RULES[2026];

const member = (over: Partial<FamilyMember>): FamilyMember => ({
  id: "m",
  name: "",
  relation: "child",
  birthDate: "2010-04-01",
  salary: 0,
  otherIncome: 0,
  livingTogether: true,
  disability: "none",
  dependentOfOther: false,
  ...over,
});

describe("salaryIncome", () => {
  it("2025 年分は最低 65 万円", () => {
    expect(salaryIncome(r2025, 1_000_000)).toBe(350_000);
    expect(salaryIncome(r2025, 1_900_000)).toBe(1_250_000);
  });

  it("2026 年分は最低 74 万円（69 万円＋特例 5 万円）", () => {
    expect(salaryIncome(r2026, 1_000_000)).toBe(260_000);
    expect(salaryIncome(r2026, 1_780_000)).toBe(1_040_000);
    expect(salaryIncome(r2026, 700_000)).toBe(0);
  });

  it("2026 年分の 219.1 万〜220 万円は固定値（国税庁 改正のあらまし 1⑵ハ）", () => {
    expect(salaryIncome(r2026, 2_190_999)).toBe(1_450_999);
    expect(salaryIncome(r2026, 2_191_000)).toBe(1_451_000);
    expect(salaryIncome(r2026, 2_195_999)).toBe(1_453_000);
    expect(salaryIncome(r2026, 2_199_999)).toBe(1_456_000);
    expect(salaryIncome(r2026, 2_200_000)).toBe(1_460_000);
  });

  it("660 万円未満は 4,000 円単位に切り捨てて計算する", () => {
    // 5,001,999 → 5,000,000 として 5,000,000 −（20% ＋ 44 万円）
    expect(salaryIncome(r2026, 5_001_999)).toBe(3_560_000);
    expect(salaryIncome(r2026, 10_000_000)).toBe(8_050_000);
  });
});

describe("年収の壁（maxSalaryWithin）", () => {
  it("2026 年分: 扶養 136 万円、特定親族 197 万円、配偶者特別 207 万円", () => {
    expect(maxSalaryWithin(r2026, 620_000)).toBe(1_360_000);
    expect(maxSalaryWithin(r2026, 1_230_000)).toBe(1_970_000);
    expect(maxSalaryWithin(r2026, 1_330_000)).toBe(2_070_000);
  });

  it("2025 年分: 扶養 123 万円", () => {
    expect(maxSalaryWithin(r2025, 580_000)).toBe(1_230_000);
  });
});

describe("ageAt", () => {
  it("12/31 時点の年齢", () => {
    expect(ageAt("2007-12-31", 2026)).toBe(19);
    expect(ageAt("2007-01-01", 2026)).toBe(19);
  });
});

describe("judgeMember", () => {
  const own = 5_000_000;
  it.each([
    ["2011-05-01", "dependentYoung", 0, 0],
    ["2010-05-01", "dependentGeneral", 380_000, 330_000],
    ["2007-05-01", "dependentSpecified", 630_000, 450_000],
    ["2004-05-01", "dependentSpecified", 630_000, 450_000],
    ["2003-05-01", "dependentGeneral", 380_000, 330_000],
  ] as const)("子 %s 生まれ → %s", (birthDate, kind, inc, res) => {
    const j = judgeMember(r2026, 2026, member({ birthDate }), own);
    expect(j.kind).toBe(kind);
    expect(j.incomeDeduction).toBe(inc);
    expect(j.residentDeduction).toBe(res);
  });

  it("70 歳以上の親は老人扶養、同居なら同居老親", () => {
    const apart = judgeMember(
      r2026,
      2026,
      member({ relation: "parent", birthDate: "1956-01-01", livingTogether: false }),
      own,
    );
    expect(apart.kind).toBe("dependentElderly");
    expect(apart.incomeDeduction).toBe(480_000);
    const living = judgeMember(
      r2026,
      2026,
      member({ relation: "parent", birthDate: "1956-01-01" }),
      own,
    );
    expect(living.kind).toBe("dependentElderlyLiving");
    expect(living.incomeDeduction).toBe(580_000);
    expect(living.residentDeduction).toBe(450_000);
  });

  it("19〜22 歳で所得が 62 万円を超えると特定親族特別控除", () => {
    // 給与 150 万円 → 所得 76 万円 → 所得税 63 万円・住民税 45 万円
    const j = judgeMember(r2026, 2026, member({ birthDate: "2006-04-01", salary: 1_500_000 }), own);
    expect(j.kind).toBe("specifiedRelative");
    expect(j.incomeDeduction).toBe(630_000);
    expect(j.residentDeduction).toBe(450_000);
    // 給与 136 万円までは特定扶養のまま
    expect(
      judgeMember(r2026, 2026, member({ birthDate: "2006-04-01", salary: 1_360_000 }), own).kind,
    ).toBe("dependentSpecified");
  });

  it("配偶者: 所得 62 万円以下は配偶者控除、超えると配偶者特別控除", () => {
    const spouse = (salary: number) =>
      judgeMember(
        r2026,
        2026,
        member({ relation: "spouse", birthDate: "1990-01-01", salary }),
        own,
      );
    expect(spouse(1_360_000).kind).toBe("spouse");
    expect(spouse(1_360_000).incomeDeduction).toBe(380_000);
    expect(spouse(1_600_000).kind).toBe("spouseSpecial");
    expect(spouse(1_600_000).incomeDeduction).toBe(380_000);
    expect(spouse(1_600_000).residentDeduction).toBe(330_000);
    expect(spouse(2_070_000).incomeDeduction).toBe(30_000);
    expect(spouse(2_080_000).kind).toBe("none");
  });

  it("本人の所得が 900 万円を超えると配偶者控除が減り、1,000 万円超で無くなる", () => {
    const s = member({ relation: "spouse", birthDate: "1990-01-01" });
    expect(judgeMember(r2026, 2026, s, 9_200_000).incomeDeduction).toBe(260_000);
    const over = judgeMember(r2026, 2026, s, 10_500_000);
    expect(over.kind).toBe("sameHouseholdSpouse");
    expect(over.incomeDeduction).toBe(0);
  });

  it("共働きで相手の扶養に入れた子は対象外", () => {
    expect(judgeMember(r2026, 2026, member({ dependentOfOther: true }), own).kind).toBe("none");
  });

  it("年収の壁: 扶養から外れるまでの残り", () => {
    const j = judgeMember(r2026, 2026, member({ birthDate: "2008-01-01", salary: 1_000_000 }), own);
    const wall = j.walls.find((w) => w.label === "扶養控除の対象")!;
    expect(wall.salaryLimit).toBe(1_360_000);
    expect(wall.room).toBe(360_000);
    expect(j.walls.find((w) => w.label === "本人に所得税がかからない")!.salaryLimit).toBe(
      1_780_000,
    );
  });
});

describe("judgeFamily", () => {
  it("23 歳未満の扶養親族（相手の扶養に入れた子も含む）を数える", () => {
    const f = judgeFamily(
      r2026,
      2026,
      [member({ birthDate: "2012-01-01", dependentOfOther: true })],
      5_000_000,
    );
    expect(f.hasDependentUnder23).toBe(true);
    expect(f.dependentCount).toBe(0);
  });
});

describe("isHousingSpecialHousehold", () => {
  it("本人 40 歳未満で配偶者がいる、または 19 歳未満の扶養親族がいる", () => {
    const spouse = member({ relation: "spouse", birthDate: "1980-01-01", salary: 3_000_000 });
    expect(isHousingSpecialHousehold(r2026, "1990-01-01", [spouse], 2026)).toBe(true);
    expect(isHousingSpecialHousehold(r2026, "1980-01-01", [spouse], 2026)).toBe(false);
    expect(
      isHousingSpecialHousehold(
        r2026,
        "1980-01-01",
        [spouse, member({ birthDate: "2010-01-01" })],
        2026,
      ),
    ).toBe(true);
    expect(isHousingSpecialHousehold(r2026, "1990-01-01", [], 2026)).toBe(false);
  });
});
