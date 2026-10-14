// 控除・確定申告のページの入力（TaxInputs）の検証。DB には Json で入れるので、読むときも書くときもここを通す。
import { z } from "zod";
import { emptyTaxInputs, type TaxInputs } from "@/lib/shared/tax-estimate";

const yen = z.number().int().min(0).max(10_000_000_000);
const yenOrNull = yen.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const disability = z.enum(["none", "general", "special", "livingSpecial"]);

const FamilyMemberSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(40),
  relation: z.enum(["spouse", "child", "parent", "other"]),
  birthDate: date,
  salary: yen,
  otherIncome: yen,
  livingTogether: z.boolean(),
  disability,
  dependentOfOther: z.boolean(),
});

export const TaxInputsSchema = z
  .object({
    selfBirthDate: date.nullable(),
    selfDisability: disability,
    selfStatus: z.enum(["none", "widow", "singleParent"]),
    workingStudent: z.boolean(),
    yearEndAdjusted: z.boolean(),
    family: z.array(FamilyMemberSchema).max(20),
    salary: yenOrNull,
    socialInsurance: yenOrNull,
    withheldTax: yenOrNull,
    businessIncome: z.number().int().min(-10_000_000_000).max(10_000_000_000).nullable(),
    blueReturnDeduction: yenOrNull,
    lifeGeneralNew: yenOrNull,
    lifeCare: yenOrNull,
    medicalPaid: yenOrNull,
    furusato: yenOrNull,
    otherIncome: yen,
    smallBusinessMutualAid: yen,
    lifeGeneralOld: yen,
    lifePensionNew: yen,
    lifePensionOld: yen,
    earthquake: yen,
    medicalReimbursed: yen,
    selfMedication: yen,
    selfMedicationEligible: z.boolean(),
    casualtyLoss: yen,
    casualtyReimbursed: yen,
    casualtyDisaster: yen,
    housingLoan: z.object({
      enabled: z.boolean(),
      movedInYear: z.number().int().min(1990).max(2100),
      build: z.enum(["new", "used"]),
      energy: z.enum(["certified", "zeh", "energy", "other"]),
      balance: yenOrNull,
      firstYear: z.boolean(),
      smallFloor: z.boolean(),
      creditOverride: yenOrNull,
    }),
    otherTaxCredit: yen,
    furusatoMunicipalities: z.number().int().min(0).max(1000),
    otherDonation: yen,
    checks: z.array(z.string().max(64)).max(100),
  })
  .strict() satisfies z.ZodType<TaxInputs>;

/**
 * DB の値を TaxInputs に直す。項目が足りない（あとから項目を増やした）ときは初期値で埋め、
 * 形が壊れているときは初期値に戻す。
 */
export function parseStoredInputs(stored: unknown, year: number): TaxInputs {
  const base = emptyTaxInputs(year);
  if (!stored || typeof stored !== "object") return base;
  const s = stored as Partial<TaxInputs>;
  const merged = { ...base, ...s, housingLoan: { ...base.housingLoan, ...(s.housingLoan ?? {}) } };
  // 保存した後に項目を減らした場合でも読めるよう、知らない項目は捨てる
  const parsed = TaxInputsSchema.strip().safeParse(merged);
  return parsed.success ? parsed.data : base;
}
