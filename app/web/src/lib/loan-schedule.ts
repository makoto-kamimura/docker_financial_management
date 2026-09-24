// 借入金の返済スケジュール・金利の計算（借入金管理の画面用）。
// 残高推移（実績＋今日以降の償還予測）、適用金利の実績・予測、金利変動前後の比較、
// 金利改定時の参考月額をここで組み立てる。
// モバイル版は app/mobile/src/shared/ に同じ内容を複製している（npm run sync:mobile で同期）。
import {
  amortizationSchedule,
  amortizationScheduleWithRates,
  rateResolver,
  recalcMonthlyPaymentAtRateChange,
  ymIndex,
} from "./debt-schedule";
import { forecastRateChanges, type RateHistoryEntry } from "./rate-forecast";

export type Repayment = {
  id: number;
  repaidOn: string;
  principal: string;
  interest: string;
  totalAmount: string;
};
export type LoanRateChange = {
  id: number;
  effectiveOn: string;
  interestRate: string;
  previousRate: string;
  /** 改定後の実際の月々返済額（金融機関の通知額）。null = 入力待ち */
  monthlyPayment: string | null;
  /** 改定直前の月々返済額 */
  previousMonthlyPayment: string | null;
  /** 「残高 × 残回数」で算出した参考値 */
  calculatedMonthlyPayment: string | null;
  note: string | null;
};
export type Loan = {
  id: number;
  lenderName: string;
  amount: string;
  interestRate: string;
  rateChanges: LoanRateChange[];
  borrowedOn: string;
  repaymentDate: string;
  remainingAmount: string;
  status: string;
  note: string | null;
  loanType: string;
  linkedAccountId: number | null;
  linkedAccount: { id: number; code: string; name: string } | null;
  monthlyPayment: string | null;
  /** 残価設定ローンの据置額（最終回に一括支払い）。null = 通常ローン */
  residualValue: string | null;
  /** true = monthlyPayment は人が入力した実額。自動計算で上書きされない */
  monthlyPaymentIsManual: boolean;
  repayments: Repayment[];
};
// 借入ごとの線の色（返済スケジュールのグラフと一覧の丸印で共用）
export const LOAN_COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];

// loans.interestRate / rate_changes.interestRate は小数（0.015 = 1.5%）で保持する。
// 償還計算（amortizationSchedule 系）は年利を % で受け取るため、渡す際に 100 倍する。
export const ratePercent = (v: string | number) => Number(v) * 100;

export const ymLabel = (ym: number) =>
  `${Math.floor(ym / 12)}/${String((ym % 12) + 1).padStart(2, "0")}`;
export const monthStartUtc = (iso: string) => {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
};

// 当初金利（最初の変更の「変更前金利」。変更が無ければ現在の金利）
export function originalRatePercent(loan: Loan): number {
  const first = [...loan.rateChanges].sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn))[0];
  return ratePercent(first ? first.previousRate : loan.interestRate);
}

// 金利改定時の参考月額（残高 × 残回数）。実額入力欄のプレースホルダと差分表示に使う。
// 5 年ルールのローンでは実際の請求額は据え置かれるため、あくまで参考値として扱う。
export function referenceMonthly(loan: Loan, effectiveOn: string, newRate: number) {
  const effective = new Date(effectiveOn);
  if (Number.isNaN(effective.getTime()) || !(newRate >= 0)) return null;
  return recalcMonthlyPaymentAtRateChange({
    principal: Number(loan.amount),
    borrowedOn: monthStartUtc(loan.borrowedOn),
    repaymentDate: monthStartUtc(loan.repaymentDate),
    baseRatePercent: originalRatePercent(loan),
    priorChanges: loan.rateChanges
      .filter((c) => new Date(c.effectiveOn) < effective)
      .map((c) => ({
        effectiveYm: ymIndex(monthStartUtc(c.effectiveOn)),
        rate: ratePercent(c.interestRate),
      })),
    monthlyPayment: loan.monthlyPayment ? Number(loan.monthlyPayment) : undefined,
    effectiveOn: monthStartUtc(effectiveOn),
    newRatePercent: ratePercent(newRate),
    residualValue: Number(loan.residualValue ?? 0),
  });
}

// 実額の返済額がまだ入力されていない最新の金利改定（＝通知待ち）。無ければ null
export function pendingRateChange(loan: Loan): LoanRateChange | null {
  const latest = [...loan.rateChanges].sort((a, b) =>
    b.effectiveOn.localeCompare(a.effectiveOn),
  )[0];
  return latest && latest.monthlyPayment === null ? latest : null;
}

export type RateComparison = {
  points: { date: string; before: number; after: number }[];
  beforeTotal: number;
  afterTotal: number;
  beforeInterest: number;
  afterInterest: number;
};

// 金利変更を反映した場合（after）と、当初金利のままだった場合（before）の
// 残高推移・総支払額・総利息を比較する。金利変更が無いローンは null。
export function buildRateComparison(loan: Loan): RateComparison | null {
  if (loan.rateChanges.length === 0) return null;

  const startUtc = monthStartUtc(loan.borrowedOn);
  const endUtc = monthStartUtc(loan.repaymentDate);
  const principal = Number(loan.amount);
  const monthly = loan.monthlyPayment ? Number(loan.monthlyPayment) : undefined;
  const base = originalRatePercent(loan);
  const changes = loan.rateChanges.map((c) => ({
    effectiveYm: ymIndex(monthStartUtc(c.effectiveOn)),
    rate: ratePercent(c.interestRate),
  }));

  const residual = Number(loan.residualValue ?? 0);
  const before = amortizationSchedule(principal, base, startUtc, endUtc, monthly, residual);
  const after = amortizationScheduleWithRates(
    principal,
    startUtc,
    endUtc,
    rateResolver(base, changes),
    monthly,
    residual,
  );
  if (before.length === 0 || after.length === 0) return null;

  const sum = (rows: typeof before, key: "payment" | "interest") =>
    rows.reduce((s, r) => s + r[key], 0);

  return {
    points: before.map((b, i) => ({
      date: ymLabel(b.ym),
      before: b.remaining,
      after: after[i]?.remaining ?? 0,
    })),
    beforeTotal: sum(before, "payment"),
    afterTotal: sum(after, "payment"),
    beforeInterest: sum(before, "interest"),
    afterInterest: sum(after, "interest"),
  };
}

export type ChartPoint = { date: string; [key: string]: number | string };

// 返済スケジュールグラフの系列キー。残高（左軸）と金利（右軸）を月次で重ねる。
export const balanceKey = (loanId: number) => `l${loanId}`;
/** 今日までの適用金利（実績。金利変更履歴から引く） */
export const rateKey = (loanId: number) => `r${loanId}`;
/** 今日以降の金利（登録済みの将来の改定 + 履歴の傾向からの予測） */
export const rateForecastKey = (loanId: number) => `rf${loanId}`;

// 金利変更履歴を予測ロジックが扱える形（ymIndex + %）へ直す
function rateHistoryOf(loan: Loan): RateHistoryEntry[] {
  return loan.rateChanges.map((c) => ({
    effectiveYm: ymIndex(monthStartUtc(c.effectiveOn)),
    rate: ratePercent(c.interestRate),
    previousRate: ratePercent(c.previousRate),
  }));
}

/**
 * ローンごとの「月 → 適用金利(%)」を返す関数を組み立てる。
 * 今日までは登録済みの履歴どおり、今日より先は登録済みの将来の改定に加えて
 * 履歴の傾向から予測した改定（{@link forecastRateChanges}）も反映する。
 */
export function rateSeriesOf(loan: Loan, endYm: number) {
  const history = rateHistoryOf(loan);
  const todayYm = ymIndex(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1)));

  // 実績側: 当初金利 + 適用済みの変更
  const actualAt = rateResolver(originalRatePercent(loan), history);

  // 予測側: 現在の金利を起点に、未来の改定（登録済み）と予測した改定を重ねる
  const scheduled = history.filter((c) => c.effectiveYm > todayYm);
  const forecast = forecastRateChanges(history, { untilYm: endYm });
  const forecastAt = rateResolver(ratePercent(loan.interestRate), [
    ...scheduled,
    // 登録済みの改定がある月は実際の値を優先する（予測で上書きしない）
    ...forecast.changes.filter((f) => !scheduled.some((s) => s.effectiveYm === f.effectiveYm)),
  ]);

  return { actualAt, forecastAt, forecast, todayYm };
}

export function buildScheduleData(loans: Loan[]): ChartPoint[] {
  if (!loans.length) return [];

  // 全ローンの開始〜終了を含む月次軸を生成
  const allDates = loans.flatMap((l) => [new Date(l.borrowedOn), new Date(l.repaymentDate)]);
  const minD = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxD = new Date(Math.max(...allDates.map((d) => d.getTime())));
  const cursor = new Date(minD.getFullYear(), minD.getMonth(), 1);
  const endM = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
  const today = new Date();

  // 金利系列はローンごとに 1 回だけ組み立てる（月ループの内側で作らない）
  const endYm = ymIndex(new Date(Date.UTC(endM.getFullYear(), endM.getMonth(), 1)));
  const rateSeries = new Map(loans.map((l) => [l.id, rateSeriesOf(l, endYm)]));

  const points: ChartPoint[] = [];

  while (cursor <= endM) {
    const label = `${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const pt: ChartPoint = { date: label };

    for (const loan of loans) {
      const start = new Date(loan.borrowedOn);
      const loanEnd = new Date(loan.repaymentDate);
      const startM = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMDate = new Date(loanEnd.getFullYear(), loanEnd.getMonth(), 1);
      const key = balanceKey(loan.id);

      if (cursor < startM) continue; // まだ始まっていない

      if (cursor > endMDate) {
        pt[key] = 0;
        continue;
      }

      // 残高と同じ月軸に適用金利を載せる（右軸）。今日を境に実績と予測を別系列にして
      // 描き分けるが、今日の月は両方に入れて線を繋げる。
      const series = rateSeries.get(loan.id);
      if (series) {
        const cursorYm = ymIndex(new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), 1)));
        if (cursorYm <= series.todayYm) {
          pt[rateKey(loan.id)] = Number(series.actualAt(cursorYm).toFixed(3));
        }
        if (cursorYm >= series.todayYm) {
          pt[rateForecastKey(loan.id)] = Number(series.forecastAt(cursorYm).toFixed(3));
        }
      }

      // ここまでの実績返済額を累積（実績がある月は実績値を優先する）
      const sorted = [...loan.repayments].sort((a, b) => a.repaidOn.localeCompare(b.repaidOn));
      let balance = Number(loan.amount);
      for (const r of sorted) {
        if (new Date(r.repaidOn) <= cursor) balance -= Number(r.principal);
      }

      // 今日以降は元利均等の償還スケジュール（amortizationSchedule）から残高を再計算する。
      // monthlyPayment が入力済みならその値を、未入力なら年利から計算した金額を毎月の返済額とする。
      // amortizationSchedule/ymIndex は UTC 基準で月数を数えるため、ブラウザのタイムゾーンによる
      // ズレ（正の UTC オフセットではローカル日付が UTC で前月にずれ得る）を避けて
      // Date.UTC で構築した日付を渡す。
      if (cursor > today) {
        const todayMonthStartUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
        const endMDateUtc = new Date(Date.UTC(endMDate.getFullYear(), endMDate.getMonth(), 1));
        const cursorUtc = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), 1));
        // 現在の金利を起点に、適用日が未来の金利変更だけを先々へ反映する
        // （適用済みの変更は loans.interestRate に反映済みのため二重適用しない）
        const futureChanges = loan.rateChanges
          .map((c) => ({
            effectiveYm: ymIndex(monthStartUtc(c.effectiveOn)),
            rate: ratePercent(c.interestRate),
          }))
          .filter((c) => c.effectiveYm > ymIndex(todayMonthStartUtc));
        const rows = amortizationScheduleWithRates(
          Number(loan.remainingAmount),
          todayMonthStartUtc,
          endMDateUtc,
          rateResolver(ratePercent(loan.interestRate), futureChanges),
          loan.monthlyPayment ? Number(loan.monthlyPayment) : undefined,
          Number(loan.residualValue ?? 0),
        );
        const offset = ymIndex(cursorUtc) - ymIndex(todayMonthStartUtc);
        balance = offset >= 0 && offset < rows.length ? rows[offset].remaining : 0;
      }

      pt[key] = Math.max(0, Math.round(balance));
    }

    points.push(pt);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return points;
}

/** 返済スケジュールの横軸（"YYYY/MM"）上の今日の月 */
export function todayLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
