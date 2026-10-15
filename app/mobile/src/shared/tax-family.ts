// 家族（配偶者・扶養親族）の判定。年齢はその年の 12/31 時点、所得は合計所得金額。
// 控除・確定申告のページ（tax-estimate.ts）が使う。Web とモバイルで同じ内容を持つ（shared-with-mobile.ts）。
import { amountFor, findRow, type TaxRules } from "./tax-rules";

export type Disability = "none" | "general" | "special" | "livingSpecial";

export type FamilyMember = {
  id: string;
  /** 画面で見分けるための呼び名（任意） */
  name: string;
  relation: "spouse" | "child" | "parent" | "other";
  /** YYYY-MM-DD */
  birthDate: string;
  /** 給与収入（額面） */
  salary: number;
  /** 給与以外の所得（年金・事業などの所得の合計） */
  otherIncome: number;
  /** 同居（老人扶養の同居老親、同居特別障害者の判定に使う） */
  livingTogether: boolean;
  disability: Disability;
  /** 共働きの配偶者など、他の人の扶養に入れる */
  dependentOfOther: boolean;
};

export type FamilyKind =
  | "spouse" // 配偶者控除
  | "spouseSpecial" // 配偶者特別控除
  | "sameHouseholdSpouse" // 同一生計配偶者（本人の所得が多く控除なし）
  | "dependentYoung" // 年少扶養（16 歳未満。控除なし）
  | "dependentGeneral"
  | "dependentSpecified"
  | "dependentElderly"
  | "dependentElderlyLiving"
  | "specifiedRelative" // 特定親族特別控除
  | "none";

export const FAMILY_KIND_LABEL: Record<FamilyKind, string> = {
  spouse: "配偶者控除",
  spouseSpecial: "配偶者特別控除",
  sameHouseholdSpouse: "同一生計配偶者（控除なし）",
  dependentYoung: "年少扶養（控除なし）",
  dependentGeneral: "扶養控除（一般）",
  dependentSpecified: "扶養控除（特定扶養）",
  dependentElderly: "扶養控除（老人扶養）",
  dependentElderlyLiving: "扶養控除（同居老親）",
  specifiedRelative: "特定親族特別控除",
  none: "控除の対象外",
};

export type IncomeWall = {
  label: string;
  /** この給与収入まで（以下）なら当てはまる */
  salaryLimit: number;
  /** 今の給与収入からあといくら */
  room: number;
};

export type FamilyJudgement = {
  member: FamilyMember;
  age: number;
  income: number;
  kind: FamilyKind;
  /** 扶養親族（年少を含む）か、同一生計配偶者か。障害者控除と住民税の非課税の人数に使う */
  dependent: boolean;
  incomeDeduction: number;
  residentDeduction: number;
  disabilityIncome: number;
  disabilityResident: number;
  /** 住民税の調整控除で使う人的控除差 */
  adjustDiff: number;
  walls: IncomeWall[];
};

/** その年の 12/31 時点の年齢 */
export function ageAt(birthDate: string, year: number): number {
  // 12/31 時点なので、誕生日がいつでも年齢は「その年 − 生まれた年」
  const y = Number(birthDate.slice(0, 4));
  return y ? year - y : 0;
}

/** 給与所得（給与収入 − 給与所得控除） */
export function salaryIncome(rules: TaxRules, salary: number): number {
  const s = Math.max(0, Math.floor(salary));
  const { minimum, brackets, roundFrom, roundTo, roundUnit, bands } = rules.salary;
  if (s < roundFrom) {
    // 固定値の区分（令和8・9年分の 219.1 万円以上 220 万円未満など）
    const band = [...bands].reverse().find((b) => s >= b.from);
    if (band) return band.income;
    return Math.max(0, s - minimum);
  }
  // 年末調整等のための給与所得控除後の給与等の金額の表に合わせ、単位未満を切り捨てて計算する
  const base = s < roundTo ? Math.floor(s / roundUnit) * roundUnit : s;
  const row = findRow(brackets, base);
  const deduction = Math.max(minimum, row ? Math.floor(base * row.rate + row.add) : minimum);
  return Math.max(0, base - deduction);
}

/** 給与所得が limit 以下に収まる給与収入の上限（年収の壁） */
export function maxSalaryWithin(rules: TaxRules, limit: number): number {
  if (limit < 0) return 0;
  let lo = 0;
  let hi = 100_000_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (salaryIncome(rules, mid) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function memberIncome(rules: TaxRules, m: FamilyMember): number {
  return salaryIncome(rules, m.salary) + Math.max(0, m.otherIncome);
}

/** 本人の合計所得の区分（配偶者控除の表の行）。0〜2 、表を超えたら -1 */
function ownColumn(rules: TaxRules, ownIncome: number): number {
  const idx = rules.personal.spouseIncome.findIndex((r) => r.upTo === null || ownIncome <= r.upTo);
  const row = rules.personal.spouseIncome[idx];
  if (!row || row.upTo === null) return -1;
  return idx;
}

function spouseSpecial(
  rows: TaxRules["personal"]["spouseSpecialIncome"],
  income: number,
  col: number,
) {
  const row = findRow(rows, income);
  if (!row) return 0;
  return [row.c1, row.c2, row.c3][col] ?? 0;
}

/** 家族ひとりの判定。ownIncome は本人（納税者）の合計所得 */
export function judgeMember(
  rules: TaxRules,
  year: number,
  m: FamilyMember,
  ownIncome: number,
): FamilyJudgement {
  const p = rules.personal;
  const age = ageAt(m.birthDate, year);
  const income = memberIncome(rules, m);
  const limit = p.dependentIncomeLimit;
  let kind: FamilyKind = "none";
  let incomeDed = 0;
  let residentDed = 0;
  let dependent = false;

  if (m.relation === "spouse") {
    const col = ownColumn(rules, ownIncome);
    const elderly = age >= 70;
    if (!m.dependentOfOther && income <= limit) {
      dependent = true;
      if (col >= 0) {
        kind = "spouse";
        const ri = p.spouseIncome[col];
        const rr = p.spouseResident[col];
        incomeDed = elderly ? ri.elderly : ri.general;
        residentDed = elderly ? rr.elderly : rr.general;
      } else {
        kind = "sameHouseholdSpouse";
      }
    } else if (!m.dependentOfOther && col >= 0 && income <= lastUpTo(p.spouseSpecialIncome)) {
      kind = "spouseSpecial";
      incomeDed = spouseSpecial(p.spouseSpecialIncome, income, col);
      residentDed = spouseSpecial(p.spouseSpecialResident, income, col);
    }
  } else if (!m.dependentOfOther) {
    if (income <= limit) {
      dependent = true;
      if (age < 16) kind = "dependentYoung";
      else if (age >= 19 && age < 23) {
        kind = "dependentSpecified";
        incomeDed = p.dependentSpecifiedIncome;
        residentDed = p.dependentSpecifiedResident;
      } else if (age >= 70) {
        const living = m.relation === "parent" && m.livingTogether;
        kind = living ? "dependentElderlyLiving" : "dependentElderly";
        incomeDed = living ? p.dependentElderlyLivingIncome : p.dependentElderlyIncome;
        residentDed = living ? p.dependentElderlyLivingResident : p.dependentElderlyResident;
      } else {
        kind = "dependentGeneral";
        incomeDed = p.dependentGeneralIncome;
        residentDed = p.dependentGeneralResident;
      }
    } else if (age >= 19 && age < 23 && income <= lastUpTo(p.specifiedRelativeIncome)) {
      kind = "specifiedRelative";
      incomeDed = amountFor(p.specifiedRelativeIncome, income);
      residentDed = amountFor(p.specifiedRelativeResident, income);
    }
  }

  // 障害者控除は扶養親族（年少を含む）と同一生計配偶者が対象
  let disIncome = 0;
  let disResident = 0;
  if (dependent && m.disability !== "none") {
    if (m.disability === "general") {
      disIncome = p.disabilityIncome;
      disResident = p.disabilityResident;
    } else if (m.disability === "livingSpecial" && m.livingTogether) {
      disIncome = p.livingSpecialDisabilityIncome;
      disResident = p.livingSpecialDisabilityResident;
    } else {
      disIncome = p.specialDisabilityIncome;
      disResident = p.specialDisabilityResident;
    }
  }

  // 調整控除の人的控除差は、配偶者控除・扶養控除・障害者控除の所得税と住民税の差。
  // 配偶者特別控除と特定親族特別控除の差は法令の区分が細かいため 0 として扱う（差は数千円以内）
  const adjustDiff =
    (kind === "spouseSpecial" || kind === "specifiedRelative" ? 0 : incomeDed - residentDed) +
    (disIncome - disResident);

  return {
    member: m,
    age,
    income,
    kind,
    dependent,
    incomeDeduction: incomeDed,
    residentDeduction: residentDed,
    disabilityIncome: disIncome,
    disabilityResident: disResident,
    adjustDiff: Math.max(0, adjustDiff),
    walls: walls(rules, m, age),
  };
}

function lastUpTo(rows: { upTo: number | null }[]): number {
  const last = rows[rows.length - 1];
  return last?.upTo ?? Number.POSITIVE_INFINITY;
}

/** 給与収入で見た「年収の壁」。給与以外の所得がある場合はその分を差し引いて求める */
function walls(rules: TaxRules, m: FamilyMember, age: number): IncomeWall[] {
  const p = rules.personal;
  const other = Math.max(0, m.otherIncome);
  const out: IncomeWall[] = [];
  const add = (label: string, incomeLimit: number) => {
    const salaryLimit = maxSalaryWithin(rules, incomeLimit - other);
    out.push({ label, salaryLimit, room: salaryLimit - m.salary });
  };
  if (m.relation === "spouse") {
    add("配偶者控除の対象", p.dependentIncomeLimit);
    add("配偶者特別控除の対象", lastUpTo(p.spouseSpecialIncome));
  } else {
    add("扶養控除の対象", p.dependentIncomeLimit);
    if (age >= 19 && age < 23) add("特定親族特別控除の対象", lastUpTo(p.specifiedRelativeIncome));
  }
  // 本人に所得税がかかり始める（社会保険料などの控除は見ない目安）
  const basic = rules.basic.income[0]?.amount ?? 0;
  add("本人に所得税がかからない", basic);
  return out.sort((a, b) => a.salaryLimit - b.salaryLimit);
}

export type FamilySummary = {
  members: FamilyJudgement[];
  /** 23 歳未満の扶養親族がいる（生命保険料控除の特例。共働きで相手の扶養に入れている子も含む） */
  hasDependentUnder23: boolean;
  /** 住民税の非課税の判定に使う人数（本人を除く同一生計配偶者・扶養親族） */
  dependentCount: number;
  spouse: FamilyJudgement | null;
};

export function judgeFamily(
  rules: TaxRules,
  year: number,
  members: FamilyMember[],
  ownIncome: number,
): FamilySummary {
  const judged = members.map((m) => judgeMember(rules, year, m, ownIncome));
  const limit = rules.personal.dependentIncomeLimit;
  return {
    members: judged,
    hasDependentUnder23: judged.some(
      (j) => j.member.relation !== "spouse" && j.age < 23 && j.income <= limit,
    ),
    dependentCount: judged.filter((j) => j.dependent).length,
    spouse: judged.find((j) => j.member.relation === "spouse") ?? null,
  };
}

/**
 * 所得金額調整控除の家族の要件。23 歳未満の扶養親族か、特別障害者の同一生計配偶者・扶養親族がいる。
 * 共働きの夫婦は同じ子で双方が受けられるため、ほかの人の扶養に入れている家族も含める（国税庁 No.1411）
 */
export function hasAdjustmentDependent(
  rules: TaxRules,
  year: number,
  members: FamilyMember[],
): boolean {
  const limit = rules.personal.dependentIncomeLimit;
  return members.some((m) => {
    if (memberIncome(rules, m) > limit) return false;
    if (m.disability === "special" || m.disability === "livingSpecial") return true;
    return m.relation !== "spouse" && ageAt(m.birthDate, year) < 23;
  });
}

/**
 * 住宅ローン控除の子育て世帯・若者夫婦世帯（特例対象個人）か。入居年の 12/31 時点で判定する。
 * 本人が 40 歳未満で配偶者がいる、配偶者が 40 歳未満、または 19 歳未満の扶養親族がいる
 */
export function isHousingSpecialHousehold(
  rules: TaxRules,
  selfBirthDate: string | null,
  members: FamilyMember[],
  movedInYear: number,
): boolean {
  const spouse = members.find((m) => m.relation === "spouse");
  if (spouse) {
    if (selfBirthDate && ageAt(selfBirthDate, movedInYear) < 40) return true;
    if (ageAt(spouse.birthDate, movedInYear) < 40) return true;
  }
  return members.some(
    (m) =>
      m.relation !== "spouse" &&
      !m.dependentOfOther &&
      ageAt(m.birthDate, movedInYear) < 19 &&
      memberIncome(rules, m) <= rules.personal.dependentIncomeLimit,
  );
}
