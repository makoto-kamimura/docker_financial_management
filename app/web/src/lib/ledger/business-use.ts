// 明細の事業利用と按分を決める（サーバー側）。計算と表示は lib/shared/business-use.ts。
//
// 事業利用をオンにして按分の指定が無ければ、科目の事業利用按分（apportionments）の割合、無ければ 100% にする。
// 画面・学習ルール・取込のどこから来ても同じ初期値になるよう、ここで決める。
import { z } from "zod";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { defaultBusinessRatio, isValidBusinessRatio } from "@/lib/shared/business-use";

export type BusinessSetting = { businessUse: boolean; businessRatio: number | null };

export const NOT_BUSINESS = { businessUse: false, businessRatio: null } as const;

/**
 * 振替・チャージの組にした明細の列。組は収入・支出ではないので、科目と事業利用を外す
 * （事業利用は組の明細には持たせない。CHECK 制約 financial_records_business_entry_only）
 */
export const PAIRED_CLEAR = { accountId: null, amount: 0, ...NOT_BUSINESS } as const;

/** API の入力（事業利用・按分）。省略は「変えない」 */
export const BusinessInput = z.object({
  businessUse: z.boolean().optional(),
  businessRatio: z
    .number()
    .refine(isValidBusinessRatio, "按分は 0 より大きく 100 以下（小数 2 桁まで）で指定してください")
    .nullable()
    .optional(),
});
export type BusinessInput = z.infer<typeof BusinessInput>;

/** 科目 id → 事業利用按分の割合（%） */
export type ApportionmentRates = Map<number, number>;

export async function loadApportionmentRates(db: TenantDbClient): Promise<ApportionmentRates> {
  const rows = await db.apportionment.findMany({
    select: { accountId: true, businessRate: true },
  });
  return new Map(rows.map((r) => [r.accountId, Number(r.businessRate)]));
}

/**
 * 入力から事業利用の設定を決める。指定が無ければ undefined（今の設定を変えない）。
 * 按分だけを指定したときは事業利用オンとみなす。
 */
export function resolveBusiness(
  input: BusinessInput,
  accountId: number | null,
  rates: ApportionmentRates,
): BusinessSetting | undefined {
  const use = input.businessUse ?? (input.businessRatio != null ? true : undefined);
  if (use === undefined) return undefined;
  if (!use) return NOT_BUSINESS;
  return {
    businessUse: true,
    businessRatio:
      input.businessRatio ?? defaultBusinessRatio(accountId === null ? null : rates.get(accountId)),
  };
}

/** 学習ルールの事業利用（null は「ルールでは決めない」） */
export function ruleBusiness(rule: {
  businessUse: boolean | null;
  businessRatio: unknown;
}): BusinessSetting | undefined {
  if (rule.businessUse === null) return undefined;
  return rule.businessUse
    ? { businessUse: true, businessRatio: Number(rule.businessRatio) }
    : NOT_BUSINESS;
}

/** 行の事業利用を API の応答の形にする（按分は数値） */
export function businessFields(r: {
  businessUse: boolean;
  businessRatio: unknown;
}): BusinessSetting {
  return {
    businessUse: r.businessUse,
    businessRatio: r.businessRatio === null ? null : Number(r.businessRatio),
  };
}

/**
 * 画面から登録する明細の事業利用。入力の指定 > 学習ルールの事業利用（ルールが科目を決めたとき）>
 * 取り込み先の既定（事業利用の口座・カード）> 事業利用なし。
 */
export async function entryBusiness(
  db: TenantDbClient,
  input: BusinessInput,
  category: { id: number; business?: BusinessSetting } | null,
  businessDefault = false,
): Promise<BusinessSetting> {
  const fromRule =
    input.businessUse === undefined && input.businessRatio == null ? category?.business : undefined;
  if (fromRule) return fromRule;
  const effective: BusinessInput =
    input.businessUse === undefined && businessDefault ? { ...input, businessUse: true } : input;
  const needsRates = effective.businessUse === true && effective.businessRatio == null;
  return (
    resolveBusiness(
      effective,
      category?.id ?? null,
      needsRates ? await loadApportionmentRates(db) : new Map(),
    ) ?? NOT_BUSINESS
  );
}

/** 明細の取り込み先（口座・カード）が事業利用か（現金は口座が無いので false） */
export async function targetIsBusiness(
  db: TenantDbClient,
  target: { kind: "CASH" } | { kind: "BANK" | "CARD"; accountId: number },
): Promise<boolean> {
  if (target.kind === "CASH") return false;
  const row =
    target.kind === "BANK"
      ? await db.bankAccount.findUnique({
          where: { id: target.accountId },
          select: { businessUse: true },
        })
      : await db.linkedAccount.findUnique({
          where: { id: target.accountId },
          select: { businessUse: true },
        });
  return row?.businessUse ?? false;
}
