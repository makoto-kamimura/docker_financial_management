// 明細の事業利用と按分（個人事業主モードで事業の分として数える割合）の計算と表示。
// 按分は % で、0 より大きく 100 以下（小数は 2 桁まで）。事業の分の額は明細ごとに円未満を切り捨てる。
// Web とモバイルで同じ内容を持つ（shared-with-mobile.ts）。

export const BUSINESS_USE_LABEL = "事業利用";
/** 科目ごとの按分の初期値の画面（旧・家事按分） */
export const BUSINESS_APPORTIONMENT_LABEL = "事業利用按分";

export const BUSINESS_RATIO_MAX = 100;

/** 按分として受け付ける値か（0 より大きく 100 以下、小数 2 桁まで） */
export function isValidBusinessRatio(ratio: number): boolean {
  return (
    Number.isFinite(ratio) &&
    ratio > 0 &&
    ratio <= BUSINESS_RATIO_MAX &&
    Math.abs(Math.round(ratio * 100) - ratio * 100) < 1e-6
  );
}

/**
 * 事業の分の額。金額 × 按分 ÷ 100 を、0 に向けて円未満を切り捨てる（負の額も同じ向き）。
 * 浮動小数の誤差を避けるため、銭と按分の 1/100 を整数にして計算する。
 */
export function businessPortion(amount: number, ratio: number): number {
  const sen = BigInt(Math.round(amount * 100));
  const ratioHundredths = BigInt(Math.round(ratio * 100));
  // 銭 × (按分 × 100) ÷ (100 × 100 × 100) = 円。BigInt の割り算は 0 に向けて切り捨てる
  return Number((sen * ratioHundredths) / 1_000_000n);
}

/** 事業利用をオンにしたときの按分の初期値（科目の事業利用按分の割合、無ければ 100%） */
export function defaultBusinessRatio(accountRate: number | null | undefined): number {
  return accountRate != null && isValidBusinessRatio(accountRate)
    ? accountRate
    : BUSINESS_RATIO_MAX;
}

/** 一覧に出す事業利用の短い表示（例: 「事業 50%」）。事業利用でなければ空 */
export function businessUseText(businessUse: boolean, ratio: number | null): string {
  if (!businessUse || ratio === null) return "";
  return `事業 ${Number.isInteger(ratio) ? ratio : ratio.toFixed(2).replace(/0+$/, "")}%`;
}
