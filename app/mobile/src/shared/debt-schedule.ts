export type DebtSchedule = {
  totalMonths: number; // 支払い回数（開始月〜解消予定月）
  monthly: number; // 月割り額（円・四捨五入）
  paidMonths: number; // 経過（支払い済み）回数
  remaining: number; // 現在の負債残高
};

export function ymIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// 元利均等返済の月額を算出する。r=0（無利子）は元本の単純割り（P/n）。
// residualValue（残価設定ローンの据置額）を渡すと、最終回に残価を一括で支払う前提で
// 毎月の返済額を求める（残価の現在価値を元本から差し引いて償却する）。
// このリポジトリの数値計算は既存 computeDebtSchedule と同様プレーンな number で統一する
// （decimal.js 等の新規依存を避けるため）。金額は最終的に円単位で四捨五入する。
export function annuityMonthlyPayment(
  principal: number,
  annualRatePercent: number,
  months: number,
  residualValue = 0,
): number {
  if (!(principal > 0) || months <= 0) return 0;
  // 残価が元本以上なら毎月は利息のみ（元本の償却が発生しない）
  const residual = Math.min(Math.max(residualValue, 0), principal);
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return Math.round((principal - residual) / months);
  const factor = Math.pow(1 + r, months);
  return Math.round(((principal - residual / factor) * r * factor) / (factor - 1));
}

export type AmortizationRow = {
  ym: number; // ymIndex() 基準の年月インデックス
  payment: number;
  principal: number;
  interest: number;
  remaining: number; // この回の返済後の残高
};

// 月別償還スケジュールを生成する。monthlyPaymentOverride を渡すとその金額を毎月の返済額として使う
// （入力値優先。design 通り未入力時のみ annuityMonthlyPayment() で計算する）。
// 最終回は利息を差し引いた残り全額を元本返済に充てることで、Σ元本 = principal を厳密に保証する
// （毎月一定額を丸めることによる誤差を最終回に吸収する）。
export function amortizationSchedule(
  principal: number,
  annualRatePercent: number,
  startOn: Date,
  endOn: Date,
  monthlyPaymentOverride?: number,
  residualValue = 0,
): AmortizationRow[] {
  return amortizationScheduleWithRates(
    principal,
    startOn,
    endOn,
    () => annualRatePercent,
    monthlyPaymentOverride,
    residualValue,
  );
}

// 変動金利の適用開始月と年利（%）。effectiveYm は ymIndex() 基準。
export type RateChange = { effectiveYm: number; rate: number };

// 金利変更履歴から「その月に適用される年利」を返す関数を組み立てる。
// baseRate は最初の変更が効く前（当初金利）。changes の順序は問わない。
export function rateResolver(baseRate: number, changes: RateChange[]): (ym: number) => number {
  const sorted = [...changes].sort((a, b) => a.effectiveYm - b.effectiveYm);
  return (ym) => {
    let rate = baseRate;
    for (const c of sorted) {
      if (c.effectiveYm <= ym) rate = c.rate;
      else break;
    }
    return rate;
  };
}

// 月ごとに異なる金利を適用できる償還スケジュール。
// monthlyPaymentOverride 未指定時は、金利が変わった月に「残高 × 残回数」で月額を再計算する
// （変動金利ローンの一般的な再計算方式）。指定時は返済額を据え置き、利息増加分だけ
// 元本充当が減る（利息が返済額を超えると残高が増える＝未払利息が乗る挙動もそのまま表す）。
export function amortizationScheduleWithRates(
  principal: number,
  startOn: Date,
  endOn: Date,
  rateAt: (ym: number) => number,
  monthlyPaymentOverride?: number,
  /** 残価設定ローンの据置額。最終回にこの額（＋利息）を一括で支払う */
  residualValue = 0,
): AmortizationRow[] {
  const startYm = ymIndex(startOn);
  const endYm = ymIndex(endOn);
  const months = endYm - startYm + 1;
  if (!(principal > 0) || months <= 0) return [];

  const residual = Math.min(Math.max(residualValue, 0), principal);
  const rows: AmortizationRow[] = [];
  let remaining = principal;
  let payment = 0;
  let currentRate: number | null = null;

  for (let i = 0; i < months; i++) {
    const ym = startYm + i;
    const annualRate = rateAt(ym);
    const r = annualRate / 100 / 12;
    const isLast = i === months - 1;

    if (monthlyPaymentOverride && monthlyPaymentOverride > 0) {
      payment = monthlyPaymentOverride;
    } else if (annualRate !== currentRate) {
      payment = annuityMonthlyPayment(remaining, annualRate, months - i, residual);
    }
    currentRate = annualRate;

    const interest = Math.round(remaining * r);
    let principalPaid: number;
    let pay: number;
    if (isLast) {
      principalPaid = remaining;
      pay = principalPaid + interest;
    } else {
      pay = payment;
      principalPaid = Math.min(pay - interest, remaining);
    }
    remaining = Math.max(0, remaining - principalPaid);
    rows.push({
      ym,
      payment: Math.round(pay),
      principal: principalPaid,
      interest,
      remaining,
    });
  }
  return rows;
}

// 当初負債額を支払い開始月〜解消予定月で均等割りし、経過月数から現在残高を算出する。
// 支払いは開始月から毎月1回行われる想定。丸め誤差は最終月に吸収し、解消予定月を過ぎたら残高0。
export function computeDebtSchedule(
  initialAmount: number,
  startOn: Date,
  payoffDue: Date,
  now: Date = new Date(),
  /** 年利（%）。0（既定）は無利子＝元本の単純割り。実物資産の紐付け負債でも金利を扱えるようにする */
  annualRatePercent = 0,
  /**
   * 月々の返済額の実額（金融機関の通知額）。指定するとこの額を毎月の返済額として残高を進める。
   * 変動金利の 5 年ルールにより、金利から計算した額と実際の請求額は一致しないため、
   * 実額が判明している場合は必ずこちらを優先する。
   */
  monthlyPaymentOverride?: number,
  /** 残価設定ローンの据置額。最終回にこの額を一括で支払う（カーローン等） */
  residualValue = 0,
): DebtSchedule | null {
  const startYm = ymIndex(startOn);
  const payoffYm = ymIndex(payoffDue);
  const totalMonths = payoffYm - startYm + 1;
  if (!(initialAmount > 0) || totalMonths <= 0) return null;

  const nowYm = now.getFullYear() * 12 + now.getMonth();
  const paidMonths = Math.min(Math.max(nowYm - startYm + 1, 0), totalMonths);
  const override =
    monthlyPaymentOverride && monthlyPaymentOverride > 0 ? monthlyPaymentOverride : undefined;
  const residual = Math.min(Math.max(residualValue, 0), initialAmount);

  // 無利子は従来どおり元本の単純割り。金利ありは元利均等（月額は annuity、残高は償還表から）
  if (!(annualRatePercent > 0)) {
    const monthly = override ?? Math.round((initialAmount - residual) / totalMonths);
    // 最終回に残価を一括で支払うため、それ以前の残高は残価を下回らない
    const remaining =
      paidMonths >= totalMonths ? 0 : Math.max(residual, initialAmount - monthly * paidMonths);
    return { totalMonths, monthly, paidMonths, remaining };
  }

  const monthly =
    override ?? annuityMonthlyPayment(initialAmount, annualRatePercent, totalMonths, residual);
  const rows = amortizationSchedule(
    initialAmount,
    annualRatePercent,
    startOn,
    payoffDue,
    monthly,
    residual,
  );
  const remaining = paidMonths <= 0 ? initialAmount : (rows[paidMonths - 1]?.remaining ?? 0);
  return { totalMonths, monthly, paidMonths, remaining: Math.max(0, Math.round(remaining)) };
}

// 金利改定時に「残高 × 残回数」で算出した参考月額と、その根拠（改定直前の残高・残回数）。
// あくまで参考値であり、実際の請求額は 5 年ルールの有無など金融機関の方式で決まる。
export type RateChangeRecalc = {
  /** 改定月の直前時点の残高 */
  balance: number;
  /** 改定月から完済予定月までの回数 */
  remainingMonths: number;
  /** 残高 × 残回数 を改定後の金利で元利均等した月額 */
  monthly: number;
};

// 金利改定の参考月額を算出する。変動金利の一般的な再計算方式である「残高 × 残回数」に従い、
// 改定直前までは既存の金利履歴（と実額があればその実額）で残高を進め、そこから改定後の金利で
// 元利均等の月額を求める。改定日が完済予定月より後なら null。
export function recalcMonthlyPaymentAtRateChange(params: {
  principal: number;
  borrowedOn: Date;
  repaymentDate: Date;
  /** 当初金利（%） */
  baseRatePercent: number;
  /** 今回の改定より前に登録済みの金利改定履歴 */
  priorChanges: RateChange[];
  /** 改定直前まで適用されていた月々の返済額（実額）。未設定なら元利均等の計算値で遡る */
  monthlyPayment?: number;
  /** 今回の改定の適用日 */
  effectiveOn: Date;
  /** 改定後の年利（%） */
  newRatePercent: number;
  /** 残価設定ローンの据置額。最終回に一括で支払うため月額の算出から除く */
  residualValue?: number;
}): RateChangeRecalc | null {
  const { principal, borrowedOn, repaymentDate, effectiveOn, newRatePercent } = params;
  const residual = Math.min(Math.max(params.residualValue ?? 0, 0), principal);
  const startYm = ymIndex(borrowedOn);
  const endYm = ymIndex(repaymentDate);
  const effectiveYm = ymIndex(effectiveOn);
  if (!(principal > 0) || endYm < startYm || effectiveYm > endYm) return null;

  const remainingMonths = endYm - Math.max(effectiveYm, startYm) + 1;

  // 改定月の直前までの残高。改定日が借入月以前なら当初元本そのもの
  let balance = principal;
  if (effectiveYm > startYm) {
    const rows = amortizationScheduleWithRates(
      principal,
      borrowedOn,
      repaymentDate,
      rateResolver(params.baseRatePercent, params.priorChanges),
      params.monthlyPayment,
      residual,
    );
    balance = rows[effectiveYm - startYm - 1]?.remaining ?? 0;
  }
  if (!(balance > 0)) return null;

  return {
    balance: Math.round(balance),
    remainingMonths,
    monthly: annuityMonthlyPayment(balance, newRatePercent, remainingMonths, residual),
  };
}
