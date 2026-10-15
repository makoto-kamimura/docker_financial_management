// 所得税・住民税の控除と税率の値（年ごと）。控除・確定申告のページの計算（tax-estimate.ts）が使う。
// ここにある値は既定値で、設定の「税制設定」から年ごとに上書きできる（TaxRuleOverride）。
// 上書きできるのは金額・閾値・率だけで、控除の種類や計算の形が変わる改正はコードの更新が要る。
// Web とモバイルで同じ内容を持つ（shared-with-mobile.ts）。
//
// 出典（2026 年分の値はこれらで確かめた）:
// - 国税庁「源泉所得税の改正のあらまし」令和8年4月 https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf
//   （基礎控除・給与所得控除の特例、扶養親族等の所得要件、配偶者特別控除・特定親族特別控除の表、
//    23 歳未満の扶養親族がいる場合の生命保険料控除、ひとり親控除の引上げ（令和9年分から））
// - 財務省「令和８年度税制改正の大綱」https://www.mof.go.jp/tax_policy/tax_reform/outline/fy2026/20251226taikou.pdf
//   （個人住民税: 令和9・10年度分の給与所得控除の最低保障額 74 万円、所得要件 62 万円、
//    住宅借入金等特別控除の令和8〜12年入居の借入限度額、ふるさと納税の特例控除の上限（令和10年度分から））
// - 国税庁 タックスアンサー No.1199 基礎控除、No.1410 給与所得控除、No.1260 所得税の税率、
//   No.1140 生命保険料控除、No.1145 地震保険料控除、No.1120 医療費控除、No.1129 セルフメディケーション税制、
//   No.1411 所得金額調整控除、No.1900 給与所得者で確定申告が必要な人
// - 個人住民税の特定親族特別控除・配偶者特別控除の額は各市区町村の「住民税の改正」資料（岡山市・世田谷区など）

/** 区分表の 1 行。upTo 以下に当てはまる（upTo が null の行は上限なし。最後の行に置く） */
export type AmountRow = { upTo: number | null; amount: number };
/** 区分表の 1 行（額 × rate + add） */
export type RateRow = { upTo: number | null; rate: number; add: number };
/** 所得税の速算表の 1 行（課税所得 × rate − deduct） */
export type TaxRateRow = { upTo: number | null; rate: number; deduct: number };
/** 配偶者控除の行。upTo は本人の合計所得 */
export type SpouseRow = { upTo: number | null; general: number; elderly: number };
/** 配偶者特別控除の行。upTo は配偶者の合計所得、c1〜c3 は本人の合計所得の区分（配偶者控除の表の行と同じ順） */
export type SpouseSpecialRow = { upTo: number | null; c1: number; c2: number; c3: number };
/** 給与所得の特例の行。給与収入が from 以上（次の行の from 未満）なら、給与所得を income とする */
export type SalaryBandRow = { from: number; income: number };
/** 住宅ローン控除の借入限度額の行。movedUpTo は入居年（この年以前の入居に当てはまる） */
export type HousingRow = {
  movedUpTo: number | null;
  limit: number;
  specialLimit: number;
  years: number;
};

export type TaxRules = {
  salary: {
    /** 給与所得控除の最低額（特例を含む） */
    minimum: number;
    /** 給与所得控除の区分表（収入 × rate + add） */
    brackets: RateRow[];
    /** 給与収入を roundUnit 単位に切り捨てて計算する範囲（roundFrom 以上 roundTo 未満） */
    roundFrom: number;
    roundTo: number;
    roundUnit: number;
    /** 給与所得を固定値にする特例の区分（roundFrom 未満に当てはまる） */
    bands: SalaryBandRow[];
    /** 所得金額調整控除: (min(給与収入, adjustCap) − adjustThreshold) × adjustRate を給与所得から引く */
    adjustThreshold: number;
    adjustCap: number;
    adjustRate: number;
  };
  basic: { income: AmountRow[]; resident: AmountRow[] };
  personal: {
    /** 同一生計配偶者・扶養親族の合計所得の上限 */
    dependentIncomeLimit: number;
    /** 勤労学生の合計所得の上限 */
    workingStudentIncomeLimit: number;
    /** 寡婦・ひとり親の本人の合計所得の上限 */
    singleParentIncomeLimit: number;
    spouseIncome: SpouseRow[];
    spouseResident: SpouseRow[];
    spouseSpecialIncome: SpouseSpecialRow[];
    spouseSpecialResident: SpouseSpecialRow[];
    dependentGeneralIncome: number;
    dependentGeneralResident: number;
    dependentSpecifiedIncome: number;
    dependentSpecifiedResident: number;
    dependentElderlyIncome: number;
    dependentElderlyResident: number;
    dependentElderlyLivingIncome: number;
    dependentElderlyLivingResident: number;
    specifiedRelativeIncome: AmountRow[];
    specifiedRelativeResident: AmountRow[];
    disabilityIncome: number;
    disabilityResident: number;
    specialDisabilityIncome: number;
    specialDisabilityResident: number;
    livingSpecialDisabilityIncome: number;
    livingSpecialDisabilityResident: number;
    widowIncome: number;
    widowResident: number;
    singleParentIncome: number;
    singleParentResident: number;
    workingStudentIncome: number;
    workingStudentResident: number;
  };
  insurance: {
    lifeNewIncome: RateRow[];
    lifeOldIncome: RateRow[];
    lifeNewResident: RateRow[];
    lifeOldResident: RateRow[];
    /** 新旧両方を払った区分の上限 */
    lifeMixedCapIncome: number;
    lifeMixedCapResident: number;
    lifeTotalCapIncome: number;
    lifeTotalCapResident: number;
    /** 23 歳未満の扶養親族がいる場合の一般生命保険料（新）の表。空なら特例なし。所得税だけ */
    lifeYoungNewIncome: RateRow[];
    lifeYoungCapIncome: number;
    earthquakeMaxIncome: number;
    earthquakeRateResident: number;
    earthquakeMaxResident: number;
    /** 旧長期損害保険料の表（地震保険料と合わせて上限まで） */
    earthquakeOldIncome: RateRow[];
    earthquakeOldResident: RateRow[];
  };
  medical: {
    floor: number;
    floorRate: number;
    max: number;
    selfMedicationFloor: number;
    selfMedicationMax: number;
  };
  casualty: { incomeRate: number; disasterFloor: number };
  donation: {
    /** 所得税の寄附金控除の対象額の上限（総所得金額等 × 率） */
    incomeRate: number;
    /** 住民税の寄附金税額控除の対象額の上限（総所得金額等 × 率） */
    residentRate: number;
    selfPay: number;
    /** ふるさと納税の特例控除の上限（住民税所得割 × 率） */
    furusatoCapRate: number;
    furusatoBaseRate: number;
    residentBasicRate: number;
    /** 特例控除の上限額（0 は上限なし） */
    furusatoCapAmount: number;
    oneStopMaxMunicipalities: number;
  };
  incomeTax: { brackets: TaxRateRow[]; surtaxRate: number };
  resident: {
    rate: number;
    perCapita: number;
    /** 所得割がかからない総所得の目安（35 万円 × 人数 ＋ 10 万円 ＋ 扶養がいる場合の加算） */
    nonTaxPerPerson: number;
    nonTaxBase: number;
    nonTaxDependentAdd: number;
    adjustRate: number;
    adjustThreshold: number;
    adjustMin: number;
    adjustIncomeLimit: number;
    /** 調整控除の人的控除差（基礎控除の分） */
    adjustBasicDiff: number;
  };
  housing: {
    rate: number;
    incomeLimit: number;
    smallFloorIncomeLimit: number;
    residentRate: number;
    residentMax: number;
    newCertified: HousingRow[];
    newZeh: HousingRow[];
    newEnergy: HousingRow[];
    newOther: HousingRow[];
    usedCertified: HousingRow[];
    usedZeh: HousingRow[];
    usedEnergy: HousingRow[];
    usedOther: HousingRow[];
  };
  filing: { otherIncomeThreshold: number; salaryThreshold: number };
};

// ── 既定値 ────────────────────────────────────────────────────────

const SALARY_BRACKETS: RateRow[] = [
  { upTo: 3_600_000, rate: 0.3, add: 80_000 },
  { upTo: 6_600_000, rate: 0.2, add: 440_000 },
  { upTo: 8_500_000, rate: 0.1, add: 1_100_000 },
  { upTo: null, rate: 0, add: 1_950_000 },
];

const RESIDENT_BASIC: AmountRow[] = [
  { upTo: 24_000_000, amount: 430_000 },
  { upTo: 24_500_000, amount: 290_000 },
  { upTo: 25_000_000, amount: 150_000 },
  { upTo: null, amount: 0 },
];

const SPOUSE_INCOME: SpouseRow[] = [
  { upTo: 9_000_000, general: 380_000, elderly: 480_000 },
  { upTo: 9_500_000, general: 260_000, elderly: 320_000 },
  { upTo: 10_000_000, general: 130_000, elderly: 160_000 },
  { upTo: null, general: 0, elderly: 0 },
];

const SPOUSE_RESIDENT: SpouseRow[] = [
  { upTo: 9_000_000, general: 330_000, elderly: 380_000 },
  { upTo: 9_500_000, general: 220_000, elderly: 260_000 },
  { upTo: 10_000_000, general: 110_000, elderly: 130_000 },
  { upTo: null, general: 0, elderly: 0 },
];

// 配偶者の合計所得が「扶養の所得要件超 〜 upTo 以下」の行。下限は personal.dependentIncomeLimit
const SPOUSE_SPECIAL_INCOME: SpouseSpecialRow[] = [
  { upTo: 950_000, c1: 380_000, c2: 260_000, c3: 130_000 },
  { upTo: 1_000_000, c1: 360_000, c2: 240_000, c3: 120_000 },
  { upTo: 1_050_000, c1: 310_000, c2: 210_000, c3: 110_000 },
  { upTo: 1_100_000, c1: 260_000, c2: 180_000, c3: 90_000 },
  { upTo: 1_150_000, c1: 210_000, c2: 140_000, c3: 70_000 },
  { upTo: 1_200_000, c1: 160_000, c2: 110_000, c3: 60_000 },
  { upTo: 1_250_000, c1: 110_000, c2: 80_000, c3: 40_000 },
  { upTo: 1_300_000, c1: 60_000, c2: 40_000, c3: 20_000 },
  { upTo: 1_330_000, c1: 30_000, c2: 20_000, c3: 10_000 },
];

const SPOUSE_SPECIAL_RESIDENT: SpouseSpecialRow[] = [
  { upTo: 1_000_000, c1: 330_000, c2: 220_000, c3: 110_000 },
  { upTo: 1_050_000, c1: 310_000, c2: 210_000, c3: 110_000 },
  { upTo: 1_100_000, c1: 260_000, c2: 180_000, c3: 90_000 },
  { upTo: 1_150_000, c1: 210_000, c2: 140_000, c3: 70_000 },
  { upTo: 1_200_000, c1: 160_000, c2: 110_000, c3: 60_000 },
  { upTo: 1_250_000, c1: 110_000, c2: 80_000, c3: 40_000 },
  { upTo: 1_300_000, c1: 60_000, c2: 40_000, c3: 20_000 },
  { upTo: 1_330_000, c1: 30_000, c2: 20_000, c3: 10_000 },
];

// 特定親族（19〜22 歳で、合計所得が扶養の所得要件超 〜 123 万円以下）
const SPECIFIED_RELATIVE_INCOME: AmountRow[] = [
  { upTo: 850_000, amount: 630_000 },
  { upTo: 900_000, amount: 610_000 },
  { upTo: 950_000, amount: 510_000 },
  { upTo: 1_000_000, amount: 410_000 },
  { upTo: 1_050_000, amount: 310_000 },
  { upTo: 1_100_000, amount: 210_000 },
  { upTo: 1_150_000, amount: 110_000 },
  { upTo: 1_200_000, amount: 60_000 },
  { upTo: 1_230_000, amount: 30_000 },
];

const SPECIFIED_RELATIVE_RESIDENT: AmountRow[] = [
  { upTo: 950_000, amount: 450_000 },
  { upTo: 1_000_000, amount: 410_000 },
  { upTo: 1_050_000, amount: 310_000 },
  { upTo: 1_100_000, amount: 210_000 },
  { upTo: 1_150_000, amount: 110_000 },
  { upTo: 1_200_000, amount: 60_000 },
  { upTo: 1_230_000, amount: 30_000 },
];

const LIFE_NEW_INCOME: RateRow[] = [
  { upTo: 20_000, rate: 1, add: 0 },
  { upTo: 40_000, rate: 0.5, add: 10_000 },
  { upTo: 80_000, rate: 0.25, add: 20_000 },
  { upTo: null, rate: 0, add: 40_000 },
];
const LIFE_OLD_INCOME: RateRow[] = [
  { upTo: 25_000, rate: 1, add: 0 },
  { upTo: 50_000, rate: 0.5, add: 12_500 },
  { upTo: 100_000, rate: 0.25, add: 25_000 },
  { upTo: null, rate: 0, add: 50_000 },
];
const LIFE_NEW_RESIDENT: RateRow[] = [
  { upTo: 12_000, rate: 1, add: 0 },
  { upTo: 32_000, rate: 0.5, add: 6_000 },
  { upTo: 56_000, rate: 0.25, add: 14_000 },
  { upTo: null, rate: 0, add: 28_000 },
];
const LIFE_OLD_RESIDENT: RateRow[] = [
  { upTo: 15_000, rate: 1, add: 0 },
  { upTo: 40_000, rate: 0.5, add: 7_500 },
  { upTo: 70_000, rate: 0.25, add: 17_500 },
  { upTo: null, rate: 0, add: 35_000 },
];
const EARTHQUAKE_OLD_INCOME: RateRow[] = [
  { upTo: 10_000, rate: 1, add: 0 },
  { upTo: 20_000, rate: 0.5, add: 5_000 },
  { upTo: null, rate: 0, add: 15_000 },
];
const EARTHQUAKE_OLD_RESIDENT: RateRow[] = [
  { upTo: 5_000, rate: 1, add: 0 },
  { upTo: 15_000, rate: 0.5, add: 2_500 },
  { upTo: null, rate: 0, add: 10_000 },
];
const LIFE_YOUNG_NEW_INCOME: RateRow[] = [
  { upTo: 30_000, rate: 1, add: 0 },
  { upTo: 60_000, rate: 0.5, add: 15_000 },
  { upTo: 120_000, rate: 0.25, add: 30_000 },
  { upTo: null, rate: 0, add: 60_000 },
];

const INCOME_TAX_BRACKETS: TaxRateRow[] = [
  { upTo: 1_949_000, rate: 0.05, deduct: 0 },
  { upTo: 3_299_000, rate: 0.1, deduct: 97_500 },
  { upTo: 6_949_000, rate: 0.2, deduct: 427_500 },
  { upTo: 8_999_000, rate: 0.23, deduct: 636_000 },
  { upTo: 17_999_000, rate: 0.33, deduct: 1_536_000 },
  { upTo: 39_999_000, rate: 0.4, deduct: 2_796_000 },
  { upTo: null, rate: 0.45, deduct: 4_796_000 },
];

// 住宅ローン控除（令和4年以後の入居。控除率 0.7%）。入居年ごとに、限度額・子育て世帯等の限度額・控除期間
const HOUSING = {
  newCertified: [
    { movedUpTo: 2023, limit: 50_000_000, specialLimit: 50_000_000, years: 13 },
    { movedUpTo: 2025, limit: 45_000_000, specialLimit: 50_000_000, years: 13 },
    { movedUpTo: null, limit: 45_000_000, specialLimit: 50_000_000, years: 13 },
  ],
  newZeh: [
    { movedUpTo: 2023, limit: 45_000_000, specialLimit: 45_000_000, years: 13 },
    { movedUpTo: 2025, limit: 35_000_000, specialLimit: 45_000_000, years: 13 },
    { movedUpTo: null, limit: 35_000_000, specialLimit: 45_000_000, years: 13 },
  ],
  newEnergy: [
    { movedUpTo: 2023, limit: 40_000_000, specialLimit: 40_000_000, years: 13 },
    { movedUpTo: 2025, limit: 30_000_000, specialLimit: 40_000_000, years: 13 },
    { movedUpTo: 2027, limit: 20_000_000, specialLimit: 30_000_000, years: 13 },
    { movedUpTo: null, limit: 0, specialLimit: 0, years: 0 },
  ],
  // 省エネ基準を満たさない新築は令和6年以後の入居で対象外（令和5年までに建築確認を受けたものを除く）
  newOther: [
    { movedUpTo: 2023, limit: 30_000_000, specialLimit: 30_000_000, years: 13 },
    { movedUpTo: null, limit: 0, specialLimit: 0, years: 0 },
  ],
  usedCertified: [
    { movedUpTo: 2025, limit: 30_000_000, specialLimit: 30_000_000, years: 10 },
    { movedUpTo: null, limit: 35_000_000, specialLimit: 45_000_000, years: 13 },
  ],
  usedZeh: [
    { movedUpTo: 2025, limit: 30_000_000, specialLimit: 30_000_000, years: 10 },
    { movedUpTo: null, limit: 35_000_000, specialLimit: 45_000_000, years: 13 },
  ],
  usedEnergy: [
    { movedUpTo: 2025, limit: 30_000_000, specialLimit: 30_000_000, years: 10 },
    { movedUpTo: null, limit: 20_000_000, specialLimit: 30_000_000, years: 13 },
  ],
  usedOther: [{ movedUpTo: null, limit: 20_000_000, specialLimit: 20_000_000, years: 10 }],
} satisfies Record<string, HousingRow[]>;

const RULES_2025: TaxRules = {
  salary: {
    minimum: 650_000,
    brackets: SALARY_BRACKETS,
    roundFrom: 1_900_000,
    roundTo: 6_600_000,
    roundUnit: 4_000,
    bands: [],
    adjustThreshold: 8_500_000,
    adjustCap: 10_000_000,
    adjustRate: 0.1,
  },
  basic: {
    income: [
      { upTo: 1_320_000, amount: 950_000 },
      { upTo: 3_360_000, amount: 880_000 },
      { upTo: 4_890_000, amount: 680_000 },
      { upTo: 6_550_000, amount: 630_000 },
      { upTo: 23_500_000, amount: 580_000 },
      { upTo: 24_000_000, amount: 480_000 },
      { upTo: 24_500_000, amount: 320_000 },
      { upTo: 25_000_000, amount: 160_000 },
      { upTo: null, amount: 0 },
    ],
    resident: RESIDENT_BASIC,
  },
  personal: {
    dependentIncomeLimit: 580_000,
    workingStudentIncomeLimit: 850_000,
    singleParentIncomeLimit: 5_000_000,
    spouseIncome: SPOUSE_INCOME,
    spouseResident: SPOUSE_RESIDENT,
    spouseSpecialIncome: SPOUSE_SPECIAL_INCOME,
    spouseSpecialResident: SPOUSE_SPECIAL_RESIDENT,
    dependentGeneralIncome: 380_000,
    dependentGeneralResident: 330_000,
    dependentSpecifiedIncome: 630_000,
    dependentSpecifiedResident: 450_000,
    dependentElderlyIncome: 480_000,
    dependentElderlyResident: 380_000,
    dependentElderlyLivingIncome: 580_000,
    dependentElderlyLivingResident: 450_000,
    specifiedRelativeIncome: SPECIFIED_RELATIVE_INCOME,
    specifiedRelativeResident: SPECIFIED_RELATIVE_RESIDENT,
    disabilityIncome: 270_000,
    disabilityResident: 260_000,
    specialDisabilityIncome: 400_000,
    specialDisabilityResident: 300_000,
    livingSpecialDisabilityIncome: 750_000,
    livingSpecialDisabilityResident: 530_000,
    widowIncome: 270_000,
    widowResident: 260_000,
    singleParentIncome: 350_000,
    singleParentResident: 300_000,
    workingStudentIncome: 270_000,
    workingStudentResident: 260_000,
  },
  insurance: {
    lifeNewIncome: LIFE_NEW_INCOME,
    lifeOldIncome: LIFE_OLD_INCOME,
    lifeNewResident: LIFE_NEW_RESIDENT,
    lifeOldResident: LIFE_OLD_RESIDENT,
    lifeMixedCapIncome: 40_000,
    lifeMixedCapResident: 28_000,
    lifeTotalCapIncome: 120_000,
    lifeTotalCapResident: 70_000,
    lifeYoungNewIncome: [],
    lifeYoungCapIncome: 40_000,
    earthquakeMaxIncome: 50_000,
    earthquakeRateResident: 0.5,
    earthquakeMaxResident: 25_000,
    earthquakeOldIncome: EARTHQUAKE_OLD_INCOME,
    earthquakeOldResident: EARTHQUAKE_OLD_RESIDENT,
  },
  medical: {
    floor: 100_000,
    floorRate: 0.05,
    max: 2_000_000,
    selfMedicationFloor: 12_000,
    selfMedicationMax: 88_000,
  },
  casualty: { incomeRate: 0.1, disasterFloor: 50_000 },
  donation: {
    incomeRate: 0.4,
    residentRate: 0.3,
    selfPay: 2_000,
    furusatoCapRate: 0.2,
    furusatoBaseRate: 0.9,
    residentBasicRate: 0.1,
    furusatoCapAmount: 0,
    oneStopMaxMunicipalities: 5,
  },
  incomeTax: { brackets: INCOME_TAX_BRACKETS, surtaxRate: 0.021 },
  resident: {
    rate: 0.1,
    perCapita: 5_000,
    nonTaxPerPerson: 350_000,
    nonTaxBase: 100_000,
    nonTaxDependentAdd: 320_000,
    adjustRate: 0.05,
    adjustThreshold: 2_000_000,
    adjustMin: 2_500,
    adjustIncomeLimit: 25_000_000,
    adjustBasicDiff: 50_000,
  },
  housing: {
    rate: 0.007,
    incomeLimit: 20_000_000,
    smallFloorIncomeLimit: 10_000_000,
    residentRate: 0.05,
    residentMax: 97_500,
    ...HOUSING,
  },
  filing: { otherIncomeThreshold: 200_000, salaryThreshold: 20_000_000 },
};

// 令和8年度改正: 基礎控除の本則 62 万円＋特例（令和8・9年分）、給与所得控除の最低 74 万円（特例込み）、
// 所得要件 62 万円、勤労学生 89 万円、23 歳未満の扶養親族がいる場合の生命保険料控除
const RULES_2026: TaxRules = {
  ...RULES_2025,
  salary: {
    ...RULES_2025.salary,
    minimum: 740_000,
    roundFrom: 2_200_000,
    // 給与収入 219.1 万円以上 220 万円未満は給与所得を固定値にする（国税庁 改正のあらまし 1⑵ハ）
    bands: [
      { from: 2_191_000, income: 1_451_000 },
      { from: 2_193_000, income: 1_453_000 },
      { from: 2_196_000, income: 1_456_000 },
    ],
  },
  basic: {
    income: [
      { upTo: 4_890_000, amount: 1_040_000 },
      { upTo: 6_550_000, amount: 670_000 },
      { upTo: 23_500_000, amount: 620_000 },
      { upTo: 24_000_000, amount: 480_000 },
      { upTo: 24_500_000, amount: 320_000 },
      { upTo: 25_000_000, amount: 160_000 },
      { upTo: null, amount: 0 },
    ],
    resident: RESIDENT_BASIC,
  },
  personal: {
    ...RULES_2025.personal,
    dependentIncomeLimit: 620_000,
    workingStudentIncomeLimit: 890_000,
  },
  insurance: {
    ...RULES_2025.insurance,
    lifeYoungNewIncome: LIFE_YOUNG_NEW_INCOME,
    lifeYoungCapIncome: 60_000,
  },
};

/** コードに持つ既定値の年（所得の年） */
export const DEFAULT_TAX_RULES: Readonly<Record<number, TaxRules>> = {
  2025: RULES_2025,
  2026: RULES_2026,
};

export const DEFAULT_RULE_YEARS = Object.keys(DEFAULT_TAX_RULES)
  .map(Number)
  .sort((a, b) => a - b);

/** その年の既定値。用意がない年は直前の年（それもなければ最も古い年）の値を返し、fallback を立てる */
export function defaultRulesFor(year: number): {
  rules: TaxRules;
  baseYear: number;
  fallback: boolean;
} {
  if (DEFAULT_TAX_RULES[year])
    return { rules: DEFAULT_TAX_RULES[year], baseYear: year, fallback: false };
  const earlier = DEFAULT_RULE_YEARS.filter((y) => y < year);
  const baseYear = earlier.length > 0 ? earlier[earlier.length - 1] : DEFAULT_RULE_YEARS[0];
  return { rules: DEFAULT_TAX_RULES[baseYear], baseYear, fallback: true };
}

// ── 設定画面で編集する項目 ──────────────────────────────────────

export type RuleUnit = "yen" | "rate" | "years" | "count" | "year";
export type RuleColumn = { key: string; label: string; unit: RuleUnit; nullable?: boolean };
export type RuleField =
  | { path: string; group: string; label: string; kind: "value"; unit: RuleUnit; note?: string }
  | {
      path: string;
      group: string;
      label: string;
      kind: "table";
      columns: RuleColumn[];
      /** この列が昇順で、最後の行だけ null（上限なし）を許す */
      ascending?: string;
      note?: string;
    };

const UP_TO: RuleColumn = { key: "upTo", label: "以下", unit: "yen", nullable: true };
const AMOUNT_COLUMNS: RuleColumn[] = [UP_TO, { key: "amount", label: "控除額", unit: "yen" }];
const RATE_COLUMNS: RuleColumn[] = [
  UP_TO,
  { key: "rate", label: "率", unit: "rate" },
  { key: "add", label: "加算", unit: "yen" },
];
const SPOUSE_COLUMNS: RuleColumn[] = [
  { key: "upTo", label: "本人の所得 以下", unit: "yen", nullable: true },
  { key: "general", label: "一般", unit: "yen" },
  { key: "elderly", label: "70 歳以上", unit: "yen" },
];
const SPOUSE_SPECIAL_COLUMNS: RuleColumn[] = [
  { key: "upTo", label: "配偶者の所得 以下", unit: "yen", nullable: true },
  { key: "c1", label: "本人 900 万円以下", unit: "yen" },
  { key: "c2", label: "950 万円以下", unit: "yen" },
  { key: "c3", label: "1,000 万円以下", unit: "yen" },
];
const HOUSING_COLUMNS: RuleColumn[] = [
  { key: "movedUpTo", label: "入居年 以前", unit: "year", nullable: true },
  { key: "limit", label: "借入限度額", unit: "yen" },
  { key: "specialLimit", label: "子育て・若者夫婦世帯", unit: "yen" },
  { key: "years", label: "控除期間", unit: "years" },
];

const value = (
  path: string,
  group: string,
  label: string,
  unit: RuleUnit,
  note?: string,
): RuleField => ({
  path,
  group,
  label,
  kind: "value",
  unit,
  note,
});
const table = (
  path: string,
  group: string,
  label: string,
  columns: RuleColumn[],
  ascending?: string,
  note?: string,
): RuleField => ({ path, group, label, kind: "table", columns, ascending, note });

export const TAX_RULE_GROUPS = [
  "給与所得控除",
  "基礎控除",
  "配偶者・扶養",
  "その他の人的控除",
  "保険料控除",
  "医療費・雑損",
  "寄附金・ふるさと納税",
  "所得税の税率",
  "住民税",
  "住宅ローン控除",
  "確定申告の判定",
] as const;

export const TAX_RULE_FIELDS: RuleField[] = [
  value("salary.minimum", "給与所得控除", "最低額（特例を含む）", "yen"),
  table("salary.brackets", "給与所得控除", "控除額の表（収入 × 率 ＋ 加算）", RATE_COLUMNS, "upTo"),
  value("salary.roundFrom", "給与所得控除", "端数を切り捨てて計算する収入（以上）", "yen"),
  value("salary.roundTo", "給与所得控除", "端数を切り捨てて計算する収入（未満）", "yen"),
  value("salary.roundUnit", "給与所得控除", "切り捨ての単位", "yen"),
  table(
    "salary.bands",
    "給与所得控除",
    "給与所得を固定値にする区分",
    [
      { key: "from", label: "収入 以上", unit: "yen" },
      { key: "income", label: "給与所得", unit: "yen" },
    ],
    "from",
  ),
  value(
    "salary.adjustThreshold",
    "給与所得控除",
    "所得金額調整控除の対象（給与収入が超える）",
    "yen",
  ),
  value("salary.adjustCap", "給与所得控除", "所得金額調整控除の給与収入の上限", "yen"),
  value("salary.adjustRate", "給与所得控除", "所得金額調整控除の率", "rate"),
  table("basic.income", "基礎控除", "所得税（合計所得の区分）", AMOUNT_COLUMNS, "upTo"),
  table("basic.resident", "基礎控除", "住民税（合計所得の区分）", AMOUNT_COLUMNS, "upTo"),
  value(
    "personal.dependentIncomeLimit",
    "配偶者・扶養",
    "扶養親族・同一生計配偶者の所得要件",
    "yen",
  ),
  table("personal.spouseIncome", "配偶者・扶養", "配偶者控除（所得税）", SPOUSE_COLUMNS, "upTo"),
  table("personal.spouseResident", "配偶者・扶養", "配偶者控除（住民税）", SPOUSE_COLUMNS, "upTo"),
  table(
    "personal.spouseSpecialIncome",
    "配偶者・扶養",
    "配偶者特別控除（所得税）",
    SPOUSE_SPECIAL_COLUMNS,
    "upTo",
  ),
  table(
    "personal.spouseSpecialResident",
    "配偶者・扶養",
    "配偶者特別控除（住民税）",
    SPOUSE_SPECIAL_COLUMNS,
    "upTo",
  ),
  value("personal.dependentGeneralIncome", "配偶者・扶養", "一般の扶養（所得税）", "yen"),
  value("personal.dependentGeneralResident", "配偶者・扶養", "一般の扶養（住民税）", "yen"),
  value("personal.dependentSpecifiedIncome", "配偶者・扶養", "特定扶養 19〜22 歳（所得税）", "yen"),
  value(
    "personal.dependentSpecifiedResident",
    "配偶者・扶養",
    "特定扶養 19〜22 歳（住民税）",
    "yen",
  ),
  value("personal.dependentElderlyIncome", "配偶者・扶養", "老人扶養（所得税）", "yen"),
  value("personal.dependentElderlyResident", "配偶者・扶養", "老人扶養（住民税）", "yen"),
  value("personal.dependentElderlyLivingIncome", "配偶者・扶養", "同居老親（所得税）", "yen"),
  value("personal.dependentElderlyLivingResident", "配偶者・扶養", "同居老親（住民税）", "yen"),
  table(
    "personal.specifiedRelativeIncome",
    "配偶者・扶養",
    "特定親族特別控除（所得税）",
    AMOUNT_COLUMNS,
    "upTo",
  ),
  table(
    "personal.specifiedRelativeResident",
    "配偶者・扶養",
    "特定親族特別控除（住民税）",
    AMOUNT_COLUMNS,
    "upTo",
  ),
  value("personal.disabilityIncome", "その他の人的控除", "障害者（所得税）", "yen"),
  value("personal.disabilityResident", "その他の人的控除", "障害者（住民税）", "yen"),
  value("personal.specialDisabilityIncome", "その他の人的控除", "特別障害者（所得税）", "yen"),
  value("personal.specialDisabilityResident", "その他の人的控除", "特別障害者（住民税）", "yen"),
  value(
    "personal.livingSpecialDisabilityIncome",
    "その他の人的控除",
    "同居特別障害者（所得税）",
    "yen",
  ),
  value(
    "personal.livingSpecialDisabilityResident",
    "その他の人的控除",
    "同居特別障害者（住民税）",
    "yen",
  ),
  value("personal.widowIncome", "その他の人的控除", "寡婦（所得税）", "yen"),
  value("personal.widowResident", "その他の人的控除", "寡婦（住民税）", "yen"),
  value("personal.singleParentIncome", "その他の人的控除", "ひとり親（所得税）", "yen"),
  value("personal.singleParentResident", "その他の人的控除", "ひとり親（住民税）", "yen"),
  value("personal.singleParentIncomeLimit", "その他の人的控除", "寡婦・ひとり親の所得要件", "yen"),
  value("personal.workingStudentIncome", "その他の人的控除", "勤労学生（所得税）", "yen"),
  value("personal.workingStudentResident", "その他の人的控除", "勤労学生（住民税）", "yen"),
  value("personal.workingStudentIncomeLimit", "その他の人的控除", "勤労学生の所得要件", "yen"),
  table("insurance.lifeNewIncome", "保険料控除", "生命保険料・新（所得税）", RATE_COLUMNS, "upTo"),
  table("insurance.lifeOldIncome", "保険料控除", "生命保険料・旧（所得税）", RATE_COLUMNS, "upTo"),
  table(
    "insurance.lifeNewResident",
    "保険料控除",
    "生命保険料・新（住民税）",
    RATE_COLUMNS,
    "upTo",
  ),
  table(
    "insurance.lifeOldResident",
    "保険料控除",
    "生命保険料・旧（住民税）",
    RATE_COLUMNS,
    "upTo",
  ),
  value("insurance.lifeMixedCapIncome", "保険料控除", "新旧両方の区分の上限（所得税）", "yen"),
  value("insurance.lifeMixedCapResident", "保険料控除", "新旧両方の区分の上限（住民税）", "yen"),
  value("insurance.lifeTotalCapIncome", "保険料控除", "生命保険料控除の合計上限（所得税）", "yen"),
  value(
    "insurance.lifeTotalCapResident",
    "保険料控除",
    "生命保険料控除の合計上限（住民税）",
    "yen",
  ),
  table(
    "insurance.lifeYoungNewIncome",
    "保険料控除",
    "23 歳未満の扶養親族がいる場合の一般・新（所得税）",
    RATE_COLUMNS,
    "upTo",
    "行がなければ特例なし",
  ),
  value(
    "insurance.lifeYoungCapIncome",
    "保険料控除",
    "23 歳未満の特例の一般の上限（所得税）",
    "yen",
  ),
  value("insurance.earthquakeMaxIncome", "保険料控除", "地震保険料の上限（所得税）", "yen"),
  value("insurance.earthquakeRateResident", "保険料控除", "地震保険料の率（住民税）", "rate"),
  value("insurance.earthquakeMaxResident", "保険料控除", "地震保険料の上限（住民税）", "yen"),
  table(
    "insurance.earthquakeOldIncome",
    "保険料控除",
    "旧長期損害保険料（所得税）",
    RATE_COLUMNS,
    "upTo",
  ),
  table(
    "insurance.earthquakeOldResident",
    "保険料控除",
    "旧長期損害保険料（住民税）",
    RATE_COLUMNS,
    "upTo",
  ),
  value("medical.floor", "医療費・雑損", "医療費控除の足切り額", "yen"),
  value("medical.floorRate", "医療費・雑損", "足切りの所得割合", "rate"),
  value("medical.max", "医療費・雑損", "医療費控除の上限", "yen"),
  value("medical.selfMedicationFloor", "医療費・雑損", "セルフメディケーションの足切り額", "yen"),
  value("medical.selfMedicationMax", "医療費・雑損", "セルフメディケーションの上限", "yen"),
  value("casualty.incomeRate", "医療費・雑損", "雑損控除の所得割合", "rate"),
  value("casualty.disasterFloor", "医療費・雑損", "災害関連支出の足切り額", "yen"),
  value("donation.incomeRate", "寄附金・ふるさと納税", "所得税の対象上限（総所得の割合）", "rate"),
  value(
    "donation.residentRate",
    "寄附金・ふるさと納税",
    "住民税の対象上限（総所得の割合）",
    "rate",
  ),
  value("donation.selfPay", "寄附金・ふるさと納税", "自己負担額", "yen"),
  value(
    "donation.furusatoCapRate",
    "寄附金・ふるさと納税",
    "特例控除の上限（所得割の割合）",
    "rate",
  ),
  value("donation.furusatoBaseRate", "寄附金・ふるさと納税", "特例控除の基準の率", "rate"),
  value("donation.residentBasicRate", "寄附金・ふるさと納税", "基本分の率", "rate"),
  value(
    "donation.furusatoCapAmount",
    "寄附金・ふるさと納税",
    "特例控除の上限額",
    "yen",
    "0 は上限なし（令和10年度分の住民税から上限あり）",
  ),
  value(
    "donation.oneStopMaxMunicipalities",
    "寄附金・ふるさと納税",
    "ワンストップ特例の自治体数",
    "count",
  ),
  table(
    "incomeTax.brackets",
    "所得税の税率",
    "速算表（課税所得 × 率 − 控除額）",
    [
      UP_TO,
      { key: "rate", label: "率", unit: "rate" },
      { key: "deduct", label: "控除額", unit: "yen" },
    ],
    "upTo",
  ),
  value("incomeTax.surtaxRate", "所得税の税率", "復興特別所得税など（所得税額に対する率）", "rate"),
  value("resident.rate", "住民税", "所得割の率", "rate"),
  value("resident.perCapita", "住民税", "均等割（森林環境税を含む目安）", "yen"),
  value("resident.nonTaxPerPerson", "住民税", "非課税の目安（1 人あたり）", "yen"),
  value("resident.nonTaxBase", "住民税", "非課税の目安（加算）", "yen"),
  value("resident.nonTaxDependentAdd", "住民税", "非課税の目安（扶養がいる場合の加算）", "yen"),
  value("resident.adjustRate", "住民税", "調整控除の率", "rate"),
  value("resident.adjustThreshold", "住民税", "調整控除の課税所得の境目", "yen"),
  value("resident.adjustMin", "住民税", "調整控除の最低額", "yen"),
  value("resident.adjustIncomeLimit", "住民税", "調整控除の所得要件", "yen"),
  value("resident.adjustBasicDiff", "住民税", "人的控除差（基礎控除）", "yen"),
  value("housing.rate", "住宅ローン控除", "控除率", "rate"),
  value("housing.incomeLimit", "住宅ローン控除", "所得要件", "yen"),
  value("housing.smallFloorIncomeLimit", "住宅ローン控除", "40〜50㎡ の所得要件", "yen"),
  value("housing.residentRate", "住宅ローン控除", "住民税から引く上限（課税所得の割合）", "rate"),
  value("housing.residentMax", "住宅ローン控除", "住民税から引く上限額", "yen"),
  table("housing.newCertified", "住宅ローン控除", "新築・認定住宅", HOUSING_COLUMNS, "movedUpTo"),
  table("housing.newZeh", "住宅ローン控除", "新築・ZEH 水準", HOUSING_COLUMNS, "movedUpTo"),
  table(
    "housing.newEnergy",
    "住宅ローン控除",
    "新築・省エネ基準適合",
    HOUSING_COLUMNS,
    "movedUpTo",
  ),
  table("housing.newOther", "住宅ローン控除", "新築・その他", HOUSING_COLUMNS, "movedUpTo"),
  table("housing.usedCertified", "住宅ローン控除", "既存・認定住宅", HOUSING_COLUMNS, "movedUpTo"),
  table("housing.usedZeh", "住宅ローン控除", "既存・ZEH 水準", HOUSING_COLUMNS, "movedUpTo"),
  table(
    "housing.usedEnergy",
    "住宅ローン控除",
    "既存・省エネ基準適合",
    HOUSING_COLUMNS,
    "movedUpTo",
  ),
  table("housing.usedOther", "住宅ローン控除", "既存・その他", HOUSING_COLUMNS, "movedUpTo"),
  value(
    "filing.otherIncomeThreshold",
    "確定申告の判定",
    "給与以外の所得（これを超えると申告）",
    "yen",
  ),
  value("filing.salaryThreshold", "確定申告の判定", "給与収入（これを超えると申告）", "yen"),
];

const FIELD_BY_PATH = new Map(TAX_RULE_FIELDS.map((f) => [f.path, f]));

export function ruleField(path: string): RuleField | undefined {
  return FIELD_BY_PATH.get(path);
}

export function getRuleValue(rules: TaxRules, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], rules);
}

function setRuleValue(rules: TaxRules, path: string, v: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>(
    (o, k) => o[k] as Record<string, unknown>,
    rules as unknown as Record<string, unknown>,
  );
  parent[last] = v;
}

/** 上書き（path → 値）。設定画面で変えた項目だけを持つ */
export type TaxRuleOverride = Record<string, unknown>;

/** 値として受け付けるか。だめなら理由を返す */
export function validateRuleValue(path: string, v: unknown): string | null {
  const field = ruleField(path);
  if (!field) return "知らない項目です";
  const checkNumber = (n: unknown, unit: RuleUnit, nullable: boolean): string | null => {
    if (n === null) return nullable ? null : "値を入れてください";
    if (typeof n !== "number" || !Number.isFinite(n)) return "数値を入れてください";
    if (n < 0) return "0 以上にしてください";
    if (unit === "rate" && n > 1) return "率は 0〜100% にしてください";
    if (unit !== "rate" && !Number.isInteger(n)) return "整数にしてください";
    return null;
  };
  if (field.kind === "value") return checkNumber(v, field.unit, false);
  if (!Array.isArray(v)) return "表の形ではありません";
  for (const [i, row] of v.entries()) {
    if (typeof row !== "object" || row === null) return `${i + 1} 行目の形が正しくありません`;
    for (const col of field.columns) {
      const isLast = i === v.length - 1;
      const nullable = !!col.nullable && (field.ascending !== col.key || isLast);
      const err = checkNumber((row as Record<string, unknown>)[col.key], col.unit, nullable);
      if (err) return `${i + 1} 行目の「${col.label}」: ${err}`;
    }
  }
  if (field.ascending) {
    const key = field.ascending;
    for (let i = 1; i < v.length; i++) {
      const prev = (v[i - 1] as Record<string, number | null>)[key];
      const cur = (v[i] as Record<string, number | null>)[key];
      if (prev === null || (cur !== null && cur <= prev)) {
        return `「${field.columns.find((c) => c.key === key)?.label}」は上から小さい順に並べてください`;
      }
    }
  }
  return null;
}

/** 既定値に上書きを重ねる。知らない項目や検証に通らない値は無視する */
export function mergeRules(
  defaults: TaxRules,
  override: TaxRuleOverride | null | undefined,
): TaxRules {
  // 値は JSON だけなので JSON で複製する（モバイルの実行環境に structuredClone が無い場合があるため）
  const merged = clone(defaults);
  for (const [path, v] of Object.entries(override ?? {})) {
    if (validateRuleValue(path, v) === null) setRuleValue(merged, path, clone(v));
  }
  return merged;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 上書きのうち、既定値と同じになった項目を落とす（保存する差分を小さく保つ） */
export function diffRules(defaults: TaxRules, edited: TaxRuleOverride): TaxRuleOverride {
  const out: TaxRuleOverride = {};
  for (const [path, v] of Object.entries(edited)) {
    if (JSON.stringify(getRuleValue(defaults, path)) !== JSON.stringify(v)) out[path] = v;
  }
  return out;
}

/**
 * その年に使う値を決める。
 * - 既定値がある年: 既定値 ＋ その年の上書き
 * - 既定値がない年: 直前の年の既定値 ＋ その年の上書き。上書きがない場合だけ fallback（改正を反映していない可能性）
 */
export function resolveRules(
  year: number,
  override: TaxRuleOverride | null | undefined,
): { rules: TaxRules; baseYear: number; fallback: boolean; changed: string[] } {
  const base = defaultRulesFor(year);
  const rules = mergeRules(base.rules, override);
  // 既定値と違う項目（画面の「変更あり」）
  const changed = TAX_RULE_FIELDS.map((f) => f.path).filter(
    (p) => JSON.stringify(getRuleValue(rules, p)) !== JSON.stringify(getRuleValue(base.rules, p)),
  );
  const hasOverride = Object.keys(override ?? {}).length > 0;
  return { rules, baseYear: base.baseYear, fallback: base.fallback && !hasOverride, changed };
}

/**
 * 前年の値（前年の既定値 ＋ 前年の上書き）を、その年の上書きとして書き出す。
 * 来年の改正を入れる前の下書きに使う。その年の既定値と同じ項目は含めない。
 */
export function copyRulesFromPreviousYear(
  year: number,
  previousOverride: TaxRuleOverride | null | undefined,
): TaxRuleOverride {
  const previous = resolveRules(year - 1, previousOverride).rules;
  const target = defaultRulesFor(year).rules;
  const all: TaxRuleOverride = {};
  for (const f of TAX_RULE_FIELDS) all[f.path] = getRuleValue(previous, f.path);
  const diff = diffRules(target, all);
  // 既定値がない年は、前年と同じ値でも「この年の値として確かめた」印に全項目を残す
  return defaultRulesFor(year).fallback ? all : diff;
}

// ── 区分表を引く ──────────────────────────────────────────────────

/** upTo の区分表から行を引く（upTo 以下に当てはまる最初の行） */
export function findRow<T extends { upTo: number | null }>(rows: T[], x: number): T | undefined {
  return rows.find((r) => r.upTo === null || x <= r.upTo);
}

export function amountFor(rows: AmountRow[], x: number): number {
  return findRow(rows, x)?.amount ?? 0;
}

/** 区分表で「額 × rate + add」を出す（円未満切り捨て） */
export function rateFor(rows: RateRow[], x: number): number {
  const row = findRow(rows, x);
  return row ? Math.floor(x * row.rate + row.add) : 0;
}
