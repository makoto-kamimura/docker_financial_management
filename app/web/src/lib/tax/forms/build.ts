// 申告書の転記用の中身（欄の番号・名前・値）。控除・確定申告のページの見込み（TaxEstimate）・入力・帳簿の明細から、
// 申告書ごとに「どの欄に何を書くか」を様式の順に並べる。PDF にする処理（./pdf.ts）とは分けて、ここは純関数にする。
// 欄の番号は国税庁「令和7年分 所得税及び復興特別所得税の確定申告の手引き」で確かめたものだけを載せる
// （収入金額等の記号、申告納税額より後の欄の番号などは名前だけ）。
import type { DeductionKey, TaxEstimate, TaxInputs, TaxLedger } from "@/lib/shared/tax-estimate";
import { FAMILY_KIND_LABEL, type FamilyJudgement } from "@/lib/shared/tax-family";
import { PAYROLL_SOCIAL_KEYS, type PayrollItemKey } from "@/lib/shared/tax-estimate";

export const FORM_KEYS = [
  "return-1",
  "return-2",
  "medical",
  "self-medication",
  "housing",
  "year-end-dependents",
  "year-end-basic",
  "year-end-insurance",
  "one-stop",
] as const;
export type FormKey = (typeof FORM_KEYS)[number];

export type FormRow = { no?: string; label: string; value?: string; note?: string };
export type FormTable = { columns: string[]; rows: string[][]; widths: number[] };
export type FormSection = { title: string; rows?: FormRow[]; table?: FormTable; note?: string };
export type FormPage = { title: string; sections: FormSection[] };
export type FormDoc = {
  key: FormKey;
  title: string;
  /** 確定申告・控除の明細書・年末調整・ふるさと納税 */
  group: string;
  /** 今の入力で要る見込みか */
  needed: boolean;
  /** 要る（要らない）理由 */
  why: string;
  pages: FormPage[];
};

/** 帳簿の明細（医療費・医薬品費・ふるさと納税）。支払先は明細の摘要 */
export type LedgerEntry = { date: string; payee: string; code: string; amount: number };

export type SelfMedicationReceiptRow = {
  date: string | null;
  merchant: string;
  amount: number;
  items: { name: string; amount: number }[];
};

export type FormContext = {
  year: number;
  estimate: TaxEstimate;
  inputs: TaxInputs;
  ledger: TaxLedger;
  medicalEntries: LedgerEntry[];
  furusatoEntries: LedgerEntry[];
  selfMedicationReceipts: SelfMedicationReceiptRow[];
};

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const yenOrBlank = (n: number) => (n === 0 ? "" : yen(n));
const reiwa = (year: number) => `令和${year - 2018}年分`;
const dateJa = (iso: string | null) => (iso ? iso.replaceAll("-", "/") : "");

/** すべての申告書の冒頭に入れる注記 */
export const FORM_DISCLAIMER =
  "このアプリの入力から作った転記用の下書きです。金額は目安なので、源泉徴収票・控除証明書などで確かめてから様式に書き写してください。氏名・住所・マイナンバーなどは空欄にしています。";

const NUMBER_NOTE = "欄の番号は令和7年分の様式のものです。年の様式で確かめてください。";

function deduction(e: TaxEstimate, ...keys: DeductionKey[]) {
  return e.deductions
    .filter((d) => keys.includes(d.key))
    .reduce((s, d) => ({ income: s.income + d.income, resident: s.resident + d.resident }), {
      income: 0,
      resident: 0,
    });
}

/** 所得税の計算（申告書第一表の税金の計算の欄） */
export function taxLines(e: TaxEstimate) {
  const t = e.incomeTax;
  const afterCredits = t.base - t.housingCredit - t.otherCredit; // ㊷（配当控除・災害減免は 0）
  const total = afterCredits + t.surtax; // ㊻
  const withheld = e.refund.withheld; // ㊾
  const diff = total - withheld;
  return {
    afterCredits,
    total,
    withheld,
    /** 申告納税額（納める税金。100 円未満は切り捨て） */
    payable: diff > 0 ? Math.floor(diff / 100) * 100 : 0,
    /** 還付される税金 */
    refund: diff < 0 ? -diff : 0,
  };
}

const SOCIAL_LABELS: Record<PayrollItemKey, string> = {
  gross: "総支給",
  commute: "通勤手当",
  health: "健康保険",
  care: "介護保険",
  childSupport: "子ども・子育て支援金",
  pension: "厚生年金",
  employment: "雇用保険",
  incomeTax: "所得税",
  residentTax: "住民税",
  other: "その他",
};

/** 社会保険料の種類ごとの額（給与明細を使うときは内訳、使わなければ合計 1 行） */
function socialInsuranceRows(ctx: FormContext): string[][] {
  const { estimate: e, inputs } = ctx;
  if (e.payroll) {
    const rows = PAYROLL_SOCIAL_KEYS.filter((k) => e.payroll!.totals[k] > 0).map((k) => [
      SOCIAL_LABELS[k],
      yen(e.payroll!.totals[k]),
    ]);
    if (inputs.payroll.otherSocialInsurance > 0) {
      rows.push(["国民年金・国民健康保険など", yen(inputs.payroll.otherSocialInsurance)]);
    }
    return rows;
  }
  const v = e.values.socialInsurance.value;
  return v > 0 ? [["社会保険料（合計）", yen(v)]] : [];
}

const isDependent = (j: FamilyJudgement) =>
  j.kind.startsWith("dependent") && j.kind !== "dependentYoung";

function familyTable(members: FamilyJudgement[]): FormTable {
  return {
    columns: ["呼び名", "続柄", "生年月日", "区分", "所得の見積額"],
    widths: [3, 2, 3, 5, 3],
    rows: members.map((j) => [
      j.member.name || "（未入力）",
      { spouse: "配偶者", child: "子", parent: "親・祖父母", other: "その他" }[j.member.relation],
      dateJa(j.member.birthDate),
      FAMILY_KIND_LABEL[j.kind] + (j.disabilityIncome > 0 ? "・障害者" : ""),
      yen(j.income),
    ]),
  };
}

// ── 確定申告書 第一表 ──
function returnForm1(ctx: FormContext): FormPage {
  const { estimate: e, year } = ctx;
  const t = taxLines(e);
  const d = (...k: DeductionKey[]) => yenOrBlank(deduction(e, ...k).income);
  const sub = deduction(
    e,
    "socialInsurance",
    "smallBusinessMutualAid",
    "lifeInsurance",
    "earthquake",
    "widow",
    "singleParent",
    "workingStudent",
    "disability",
    "spouse",
    "dependents",
    "specifiedRelative",
    "basic",
  ).income;
  const medicalLabel =
    e.medicalChoice.chosen === "selfMedication"
      ? "医療費控除（セルフメディケーション税制。区分に「1」）"
      : "医療費控除";
  return {
    title: `確定申告書 第一表（${reiwa(year)}）`,
    sections: [
      {
        title: "収入金額等",
        rows: [
          { label: "給与", value: yenOrBlank(e.income.salary) },
          ...(ctx.ledger.businessIncome !== null
            ? [
                {
                  label: "事業（営業等）の所得",
                  value: yen(e.income.business),
                  note: "青色申告決算書から",
                },
              ]
            : []),
        ],
      },
      {
        title: "所得金額等",
        rows: [
          { no: "⑥", label: "給与", value: yenOrBlank(e.income.salaryIncome) },
          ...(e.income.other > 0
            ? [{ label: "その他の所得", value: yen(e.income.other), note: "所得の種類の欄に書く" }]
            : []),
          { no: "⑫", label: "合計", value: yen(e.income.total) },
        ],
      },
      {
        title: "所得から差し引かれる金額",
        rows: [
          { no: "⑬", label: "社会保険料控除", value: d("socialInsurance") },
          { no: "⑭", label: "小規模企業共済等掛金控除", value: d("smallBusinessMutualAid") },
          { no: "⑮", label: "生命保険料控除", value: d("lifeInsurance") },
          { no: "⑯", label: "地震保険料控除", value: d("earthquake") },
          { no: "⑰〜⑱", label: "寡婦、ひとり親控除", value: d("widow", "singleParent") },
          { no: "⑲〜⑳", label: "勤労学生、障害者控除", value: d("workingStudent", "disability") },
          { no: "㉑〜㉒", label: "配偶者（特別）控除", value: d("spouse") },
          { no: "㉓", label: "扶養控除", value: d("dependents") },
          { no: "㉔", label: "特定親族特別控除", value: d("specifiedRelative") },
          { no: "㉕", label: "基礎控除", value: d("basic") },
          { no: "㉖", label: "⑬から㉕までの計", value: yen(sub) },
          { no: "㉗", label: "雑損控除", value: d("casualty") },
          { no: "㉘", label: medicalLabel, value: d("medical") },
          { no: "㉙", label: "寄附金控除", value: d("donation") },
          { no: "㉚", label: "合計", value: yen(e.deductionTotal.income) },
        ],
      },
      {
        title: "税金の計算",
        rows: [
          {
            no: "㉛",
            label: "課税される所得金額",
            value: yen(e.taxable.income),
            note: "1,000 円未満切り捨て",
          },
          { no: "㉜", label: "上の㉛に対する税額", value: yen(e.incomeTax.base) },
          {
            no: "㉟",
            label: "（特定増改築等）住宅借入金等特別控除",
            value: yenOrBlank(e.incomeTax.housingCredit),
          },
          ...(e.incomeTax.otherCredit > 0
            ? [
                {
                  no: "㊱〜㊶",
                  label: "政党等寄附金等特別控除など",
                  value: yen(e.incomeTax.otherCredit),
                },
              ]
            : []),
          { no: "㊷", label: "差引所得税額", value: yen(t.afterCredits) },
          { no: "㊹", label: "再差引所得税額（基準所得税額）", value: yen(t.afterCredits) },
          { no: "㊺", label: "復興特別所得税額（㊹×2.1%）", value: yen(e.incomeTax.surtax) },
          { no: "㊻", label: "所得税及び復興特別所得税の額", value: yen(t.total) },
          {
            no: "㊾",
            label: "所得税及び復興特別所得税の源泉徴収税額",
            value: yenOrBlank(t.withheld),
          },
          {
            label: "申告納税額（納める税金）",
            value: yenOrBlank(t.payable),
            note: "100 円未満切り捨て",
          },
          { label: "還付される税金", value: yenOrBlank(t.refund) },
        ],
      },
    ],
  };
}

// ── 確定申告書 第二表 ──
function returnForm2(ctx: FormContext): FormPage {
  const { estimate: e, inputs, year } = ctx;
  const furusato = e.furusato.donated;
  const sections: FormSection[] = [
    {
      title: "所得の内訳（所得税及び復興特別所得税の源泉徴収税額）",
      table: {
        columns: ["所得の種類", "支払者の名称", "収入金額", "源泉徴収税額"],
        widths: [2, 5, 3, 3],
        rows:
          e.income.salary > 0 ? [["給与", "", yen(e.income.salary), yen(e.refund.withheld)]] : [],
      },
      note: "支払者の名称は源泉徴収票のとおりに書きます。",
    },
    {
      title: "⑬ 社会保険料控除",
      table: {
        columns: ["保険料等の種類", "支払保険料等の計"],
        widths: [5, 3],
        rows: socialInsuranceRows(ctx),
      },
    },
    {
      title: "⑭ 小規模企業共済等掛金控除",
      rows: [
        { label: "iDeCo・小規模企業共済の掛金", value: yenOrBlank(inputs.smallBusinessMutualAid) },
      ],
    },
    {
      title: "⑮ 生命保険料控除",
      rows: [
        { label: "新生命保険料", value: yenOrBlank(e.values.lifeGeneralNew.value) },
        { label: "旧生命保険料", value: yenOrBlank(inputs.lifeGeneralOld) },
        { label: "新個人年金保険料", value: yenOrBlank(inputs.lifePensionNew) },
        { label: "旧個人年金保険料", value: yenOrBlank(inputs.lifePensionOld) },
        { label: "介護医療保険料", value: yenOrBlank(e.values.lifeCare.value) },
      ],
    },
    {
      title: "⑯ 地震保険料控除",
      rows: [{ label: "地震保険料", value: yenOrBlank(inputs.earthquake) }],
    },
    {
      title: "本人に関する事項（⑰〜⑳）",
      rows: [
        {
          label: "寡婦・ひとり親",
          value: { none: "", widow: "寡婦", singleParent: "ひとり親" }[inputs.selfStatus],
        },
        { label: "勤労学生", value: inputs.workingStudent ? "あり" : "" },
        {
          label: "障害者",
          value: {
            none: "",
            general: "障害者",
            special: "特別障害者",
            livingSpecial: "特別障害者",
          }[inputs.selfDisability],
        },
      ],
    },
    {
      title: "㉙ 寄附金控除",
      rows: [
        {
          label: "寄附先の名称等",
          value: furusato > 0 ? "ふるさと納税（寄附金受領証明書のとおり）" : "",
        },
        { label: "寄附金", value: yenOrBlank(furusato + inputs.otherDonation) },
      ],
    },
    {
      title: "配偶者や親族に関する事項（⑳〜㉔）",
      table: familyTable(e.family.members.filter((j) => j.kind !== "none")),
      note: "氏名・個人番号は空欄です。別居の家族は住所も書きます。",
    },
    {
      title: "住民税・事業税に関する事項",
      rows: [
        {
          label: "寄附金税額控除（都道府県・市区町村分）",
          value: yenOrBlank(furusato),
          note: "ふるさと納税は「都道府県、市区町村分」の欄",
        },
        {
          label: "給与、公的年金等以外の所得に係る住民税の徴収方法",
          value: "",
          note: "特別徴収・自分で納付のどちらかを選ぶ",
        },
      ],
    },
  ];
  return { title: `確定申告書 第二表（${reiwa(year)}）`, sections };
}

/** 支払先・区分ごとにまとめる（区分は科目から） */
function groupEntries(entries: LedgerEntry[], kindOf: (code: string) => string) {
  const map = new Map<string, { payee: string; kind: string; amount: number; count: number }>();
  for (const en of entries) {
    const kind = kindOf(en.code);
    const key = `${kind}\u0000${en.payee}`;
    const g = map.get(key) ?? { payee: en.payee || "（摘要なし）", kind, amount: 0, count: 0 };
    g.amount += en.amount;
    g.count += 1;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// ── 医療費控除の明細書 ──
function medicalForm(ctx: FormContext): FormPage {
  const { estimate: e, inputs, year } = ctx;
  const rows = groupEntries(ctx.medicalEntries, (c) =>
    c === "H-2006" ? "医薬品購入" : "診療・治療",
  );
  const listed = rows.reduce((s, r) => s + r.amount, 0);
  const paid = e.values.medicalPaid.value;
  const reimbursed = inputs.medicalReimbursed;
  const floor = Math.min(100_000, Math.floor(e.income.total * 0.05));
  return {
    title: `医療費控除の明細書（${reiwa(year)}）`,
    sections: [
      {
        title: "医療費の明細（帳簿の医療費・医薬品費の実績を支払先ごとに集計）",
        table: {
          columns: [
            "医療を受けた人",
            "病院・薬局などの支払先",
            "区分",
            "支払った医療費の額",
            "補塡される金額",
          ],
          widths: [3, 6, 3, 3, 3],
          rows: rows.map((r) => ["", `${r.payee}（${r.count}件）`, r.kind, yen(r.amount), ""]),
        },
        note: "ビタミン剤・予防の薬・美容などは対象外なので除いてください。医療費通知を使う場合は通知の合計を書きます。",
      },
      {
        title: "控除額の計算",
        rows: [
          {
            label: "支払った医療費（A）",
            value: yen(paid),
            note: listed !== paid ? `明細の合計は ${yen(listed)}（予定・手入力との差）` : undefined,
          },
          { label: "保険金などで補塡される金額（B）", value: yen(reimbursed) },
          { label: "差引金額（A − B）（C）", value: yen(Math.max(0, paid - reimbursed)) },
          { label: "所得金額の合計額（D）", value: yen(e.income.total) },
          { label: "D × 0.05（E）", value: yen(Math.floor(e.income.total * 0.05)) },
          { label: "E と 10 万円のいずれか少ない金額（F）", value: yen(floor) },
          { label: "医療費控除額（C − F。最高 200 万円）", value: yen(e.medicalChoice.medical) },
        ],
      },
    ],
  };
}

// ── セルフメディケーション税制の明細書 ──
function selfMedicationForm(ctx: FormContext): FormPage {
  const { estimate: e, year } = ctx;
  const receipts = ctx.selfMedicationReceipts;
  const paid = e.values.selfMedication.value;
  const listed = receipts.reduce((s, r) => s + r.amount, 0);
  return {
    title: `セルフメディケーション税制の明細書（${reiwa(year)}）`,
    sections: [
      {
        title: "申告する方の健康の保持増進及び疾病の予防への取組",
        rows: [
          {
            label: "取組に要した費用に係る領収書などの名称",
            value: "",
            note: "健康診断・予防接種・特定健診などの結果通知や領収書",
          },
          { label: "発行者名", value: "" },
        ],
      },
      {
        title: "特定一般用医薬品等購入費の明細（保存したレシート）",
        table: {
          columns: ["購入日", "薬品名", "支払先の名称", "支払った金額"],
          widths: [3, 6, 5, 3],
          rows: receipts.flatMap((r) =>
            r.items.length > 0
              ? r.items.map((i) => [dateJa(r.date), i.name, r.merchant, yen(i.amount)])
              : [[dateJa(r.date), "（品名はレシートのとおり）", r.merchant, yen(r.amount)]],
          ),
        },
        note:
          receipts.length === 0
            ? "保存したレシートはありません。購入額の合計だけを下に書いています。"
            : "レシートは確定申告の期限から 5 年間保存します。",
      },
      {
        title: "控除額の計算",
        rows: [
          {
            label: "支払った金額（A）",
            value: yen(paid),
            note: listed !== paid ? `保存したレシートの合計は ${yen(listed)}` : undefined,
          },
          { label: "保険金などで補塡される金額（B）", value: "" },
          { label: "差引金額（A − B）", value: yen(paid) },
          {
            label: "控除額（差引金額 − 12,000 円。最高 88,000 円）",
            value: yen(e.medicalChoice.selfMedication),
          },
        ],
      },
    ],
  };
}

// ── 住宅借入金等特別控除額の計算明細書 ──
function housingForm(ctx: FormContext): FormPage {
  const { estimate: e, inputs, year } = ctx;
  const h = inputs.housingLoan;
  const r = e.housing;
  const energy = {
    certified: "認定住宅",
    zeh: "ZEH 水準省エネ住宅",
    energy: "省エネ基準適合住宅",
    other: "その他の住宅",
  }[h.energy];
  return {
    title: `（特定増改築等）住宅借入金等特別控除額の計算明細書（${reiwa(year)}）`,
    sections: [
      {
        title: "住宅の取得などの内容",
        rows: [
          {
            label: "居住開始年",
            value: `${h.movedInYear}年（令和${h.movedInYear - 2018}年）`,
            note: "月日は登記事項証明書などのとおり",
          },
          {
            label: "住宅の区分",
            value: `${h.build === "new" ? "新築・買取再販" : "既存住宅"}／${energy}`,
          },
          { label: "床面積 40〜50㎡の特例", value: h.smallFloor ? "あり" : "" },
          { label: "子育て世帯・若者夫婦世帯の特例", value: r?.special ? "あり" : "" },
        ],
      },
      {
        title: "控除額の計算",
        rows: [
          {
            label: "住宅借入金等の年末残高",
            value: yen(r?.balance ?? 0),
            note: "年末残高等証明書のとおり",
          },
          { label: "借入限度額", value: yenOrBlank(r?.limit ?? 0) },
          { label: "控除率", value: "0.7%" },
          { label: "住宅借入金等特別控除額（100 円未満切り捨て）", value: yen(r?.credit ?? 0) },
          { label: "控除期間", value: r?.years ? `${r.years}年（${r.yearIndex}年目）` : "" },
        ],
        note: r?.reason ?? "所得税から引ききれない分は、翌年度の住民税から引かれます。",
      },
    ],
  };
}

// ── 年末調整: 扶養控除等（異動）申告書 ──
function yearEndDependentsForm(ctx: FormContext): FormPage {
  const { estimate: e, year } = ctx;
  const spouse = e.family.spouse;
  return {
    title: `給与所得者の扶養控除等（異動）申告書（${reiwa(year)}）`,
    sections: [
      {
        title: "源泉控除対象配偶者",
        table: familyTable(
          spouse && spouse.kind !== "none" && spouse.kind !== "sameHouseholdSpouse" ? [spouse] : [],
        ),
        note: "本人の合計所得が 900 万円以下で、配偶者の所得が 95 万円以下の場合に書きます。",
      },
      {
        title: "控除対象扶養親族（16 歳以上）",
        table: familyTable(e.family.members.filter(isDependent)),
      },
      {
        title: "障害者・寡婦・ひとり親・勤労学生",
        rows: [
          {
            label: "本人",
            value: {
              none: "",
              general: "一般の障害者",
              special: "特別障害者",
              livingSpecial: "特別障害者",
            }[ctx.inputs.selfDisability],
          },
          {
            label: "寡婦・ひとり親",
            value: { none: "", widow: "寡婦", singleParent: "ひとり親" }[ctx.inputs.selfStatus],
          },
          { label: "勤労学生", value: ctx.inputs.workingStudent ? "あり" : "" },
          {
            label: "障害のある家族",
            value: e.family.members
              .filter((j) => j.disabilityIncome > 0)
              .map((j) => j.member.name || "（未入力）")
              .join("、"),
          },
        ],
      },
      {
        title: "住民税に関する事項（16 歳未満の扶養親族）",
        table: familyTable(e.family.members.filter((j) => j.kind === "dependentYoung")),
      },
    ],
  };
}

// ── 年末調整: 基礎控除申告書 兼 配偶者控除等申告書 兼 所得金額調整控除申告書 ──
function yearEndBasicForm(ctx: FormContext): FormPage {
  const { estimate: e, year } = ctx;
  const spouse = e.family.spouse;
  return {
    title: `基礎控除申告書 兼 配偶者控除等申告書 兼 所得金額調整控除申告書（${reiwa(year)}）`,
    sections: [
      {
        title: "基礎控除申告書（あなたの本年中の合計所得金額の見積額）",
        rows: [
          { label: "給与所得の収入金額", value: yen(e.income.salary) },
          { label: "給与所得の所得金額", value: yen(e.income.salaryIncome) },
          { label: "給与所得以外の所得の合計額", value: yen(e.income.business + e.income.other) },
          { label: "あなたの本年中の合計所得金額の見積額", value: yen(e.income.total) },
          { label: "基礎控除の額", value: yen(deduction(e, "basic").income) },
        ],
      },
      {
        title: "配偶者控除等申告書",
        rows: spouse
          ? [
              { label: "配偶者の給与所得の収入金額", value: yen(spouse.member.salary) },
              { label: "配偶者の本年中の合計所得金額の見積額", value: yen(spouse.income) },
              { label: "区分", value: FAMILY_KIND_LABEL[spouse.kind] },
              {
                label: "配偶者控除の額・配偶者特別控除の額",
                value: yenOrBlank(spouse.incomeDeduction),
              },
            ]
          : [{ label: "配偶者", value: "なし" }],
      },
      {
        title: "所得金額調整控除申告書",
        rows: [
          {
            label: "要件（本人・家族の特別障害者、23 歳未満の扶養親族）",
            value: "",
            note: "給与収入が 850 万円を超える場合だけ書きます",
          },
        ],
      },
    ],
  };
}

// ── 年末調整: 保険料控除申告書 ──
function yearEndInsuranceForm(ctx: FormContext): FormPage {
  const { estimate: e, inputs, year } = ctx;
  const life = deduction(e, "lifeInsurance").income;
  return {
    title: `給与所得者の保険料控除申告書（${reiwa(year)}）`,
    sections: [
      {
        title: "生命保険料控除（控除証明書ごとに保険会社等の名称・保険金額などを書きます）",
        rows: [
          { label: "一般の生命保険料（新）", value: yenOrBlank(e.values.lifeGeneralNew.value) },
          { label: "一般の生命保険料（旧）", value: yenOrBlank(inputs.lifeGeneralOld) },
          { label: "介護医療保険料", value: yenOrBlank(e.values.lifeCare.value) },
          { label: "個人年金保険料（新）", value: yenOrBlank(inputs.lifePensionNew) },
          { label: "個人年金保険料（旧）", value: yenOrBlank(inputs.lifePensionOld) },
          { label: "生命保険料控除額", value: yen(life) },
        ],
        note:
          ctx.ledger.insuranceRefund > 0
            ? `一般の生命保険料は、帳簿の保険割戻金 ${yen(ctx.ledger.insuranceRefund)} を差し引いています。`
            : undefined,
      },
      {
        title: "地震保険料控除",
        rows: [
          { label: "地震保険料", value: yenOrBlank(inputs.earthquake) },
          { label: "地震保険料控除額", value: yenOrBlank(deduction(e, "earthquake").income) },
        ],
      },
      {
        title: "社会保険料控除（あなたが直接支払ったもの）",
        rows: [
          {
            label: "国民年金・国民健康保険など",
            value: yenOrBlank(inputs.payroll.enabled ? inputs.payroll.otherSocialInsurance : 0),
            note: "給与から差し引かれた社会保険料は書きません",
          },
        ],
      },
      {
        title: "小規模企業共済等掛金控除",
        rows: [
          {
            label: "個人型確定拠出年金（iDeCo）・小規模企業共済の掛金",
            value: yenOrBlank(inputs.smallBusinessMutualAid),
          },
        ],
      },
    ],
  };
}

// ── ワンストップ特例申請書（寄附先ごとに 1 枚） ──
function oneStopPages(ctx: FormContext): FormPage[] {
  const { estimate: e, inputs, year } = ctx;
  const groups = new Map<string, LedgerEntry[]>();
  for (const en of ctx.furusatoEntries) {
    const key = en.payee || "（摘要なし）";
    groups.set(key, [...(groups.get(key) ?? []), en]);
  }
  const fiveOrLess = inputs.furusatoMunicipalities <= 5;
  const page = (payee: string, entries: LedgerEntry[]): FormPage => ({
    title: `寄附金税額控除に係る申告特例申請書（${reiwa(year)}）`,
    sections: [
      {
        title: "寄附先",
        rows: [
          {
            label: "寄附先の地方団体の長",
            value: payee,
            note: "帳簿の摘要。正式な自治体名を書きます",
          },
        ],
      },
      {
        title: "寄附",
        table: {
          columns: ["寄附年月日", "寄附金額"],
          widths: [4, 4],
          rows: entries.map((en) => [dateJa(en.date), yen(en.amount)]),
        },
      },
      {
        title: "申告特例の要件",
        rows: [
          {
            label: "地方税法附則第7条第1項（第8項）に規定する申告特例対象寄附者である",
            value: e.filing.willFile ? "（確定申告をするので使えません）" : "☑",
          },
          {
            label: "その年の寄附先が 5 団体以下である見込み",
            value: fiveOrLess ? "☑" : "（6 団体以上のため使えません）",
          },
        ],
        note: "本人確認書類（マイナンバーカードの写しなど）を添えて、寄附した翌年の 1 月 10 日までに送ります。",
      },
    ],
  });
  const pages = [...groups.entries()].map(([payee, entries]) => page(payee, entries));
  return pages.length > 0 ? pages : [page("", [])];
}

/** 申告書の一覧（要るかの判定と中身）。key を渡すとその 1 つだけ */
export function buildForms(ctx: FormContext): FormDoc[] {
  const e = ctx.estimate;
  const salaried = e.income.salary > 0;
  const yearEnd = salaried && ctx.inputs.yearEndAdjusted;
  const yearEndWhy = yearEnd ? "勤め先の年末調整で出す" : "年末調整を受けないので不要";
  const docs: FormDoc[] = [
    {
      key: "return-1",
      title: "確定申告書 第一表",
      group: "確定申告",
      needed: e.filing.willFile,
      why: e.filing.willFile ? "確定申告をする見込み" : "確定申告は要らない見込み",
      pages: [returnForm1(ctx)],
    },
    {
      key: "return-2",
      title: "確定申告書 第二表",
      group: "確定申告",
      needed: e.filing.willFile,
      why: e.filing.willFile ? "確定申告をする見込み" : "確定申告は要らない見込み",
      pages: [returnForm2(ctx)],
    },
    {
      key: "medical",
      title: "医療費控除の明細書",
      group: "控除の明細書",
      needed: e.medicalChoice.chosen === "medical",
      why:
        e.medicalChoice.chosen === "medical" ? "医療費控除を受ける" : "医療費控除を使わない見込み",
      pages: [medicalForm(ctx)],
    },
    {
      key: "self-medication",
      title: "セルフメディケーション税制の明細書",
      group: "控除の明細書",
      needed: e.medicalChoice.chosen === "selfMedication",
      why:
        e.medicalChoice.chosen === "selfMedication"
          ? "セルフメディケーション税制を使う"
          : "セルフメディケーション税制を使わない見込み",
      pages: [selfMedicationForm(ctx)],
    },
    {
      key: "housing",
      title: "住宅借入金等特別控除額の計算明細書",
      group: "控除の明細書",
      needed:
        !!e.housing?.eligible && (ctx.inputs.housingLoan.firstYear || !ctx.inputs.yearEndAdjusted),
      why: e.housing?.eligible
        ? ctx.inputs.housingLoan.firstYear
          ? "住宅ローン控除の初年度"
          : "2 年目以降は年末調整（年末調整を受けなければ確定申告）"
        : "住宅ローン控除を受けない見込み",
      pages: [housingForm(ctx)],
    },
    {
      key: "year-end-dependents",
      title: "扶養控除等（異動）申告書",
      group: "年末調整",
      needed: yearEnd,
      why: yearEndWhy,
      pages: [yearEndDependentsForm(ctx)],
    },
    {
      key: "year-end-basic",
      title: "基礎控除申告書 兼 配偶者控除等申告書 兼 所得金額調整控除申告書",
      group: "年末調整",
      needed: yearEnd,
      why: yearEndWhy,
      pages: [yearEndBasicForm(ctx)],
    },
    {
      key: "year-end-insurance",
      title: "保険料控除申告書",
      group: "年末調整",
      needed:
        yearEnd &&
        (deduction(e, "lifeInsurance", "earthquake", "smallBusinessMutualAid").income > 0 ||
          (ctx.inputs.payroll.enabled && ctx.inputs.payroll.otherSocialInsurance > 0)),
      why: yearEnd ? "生命保険料・地震保険料・iDeCo などを年末調整で控除する" : yearEndWhy,
      pages: [yearEndInsuranceForm(ctx)],
    },
    {
      key: "one-stop",
      title: "ワンストップ特例申請書",
      group: "ふるさと納税",
      needed: e.furusato.path === "oneStop",
      why:
        e.furusato.path === "oneStop"
          ? "確定申告をしないので、寄附先ごとに申請する"
          : e.furusato.path === "return"
            ? "確定申告で寄附金控除を受けるので不要"
            : "ふるさと納税の寄付が無い",
      pages: oneStopPages(ctx),
    },
  ];
  return docs;
}

export { NUMBER_NOTE };
