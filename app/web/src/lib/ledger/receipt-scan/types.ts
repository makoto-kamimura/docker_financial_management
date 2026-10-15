// レシートの読み取り結果（下書き）。読み取ったあと、利用者が確かめてから実績として登録する。
// Claude の構造化出力に渡すため、zod は SDK に合わせて v4 の API で書く。
import * as z from "zod/v4";

export const PAYMENT_METHODS = ["cash", "card", "emoney", "unknown"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ReceiptDraftSchema = z.object({
  date: z.string().nullable().describe("レシートの日付。YYYY-MM-DD。読めなければ null"),
  merchant: z
    .string()
    .nullable()
    .describe("店名（支店名・電話番号・住所は含めない）。読めなければ null"),
  total: z
    .number()
    .int()
    .nullable()
    .describe("支払った合計金額（税込、円）。小計・お預り・お釣りではない。読めなければ null"),
  items: z
    .array(
      z.object({
        name: z.string(),
        amount: z.number().int().describe("金額（円）。値引きは負の数"),
        selfMedication: z
          .boolean()
          .describe(
            "セルフメディケーション税制の対象品なら true（品名の前後の ★・◆ などの印が、レシートの注記で対象を示しているもの）",
          ),
      }),
    )
    .describe("品目。読めなければ空の配列"),
  selfMedicationTotal: z
    .number()
    .int()
    .nullable()
    .describe(
      "レシートに印字されたセルフメディケーション税制の対象額の合計（円）。印字が無ければ null",
    ),
  paymentMethod: z
    .enum(PAYMENT_METHODS)
    .describe("支払方法。現金=cash、クレジットカード=card、電子マネー・QR コード決済=emoney"),
});
export type ReceiptDraft = z.infer<typeof ReceiptDraftSchema>;

export type ReceiptEngine = "claude" | "tesseract";

export type ScanUsage = { model: string; inputTokens: number; outputTokens: number };

export type ScanResult = { draft: ReceiptDraft; usage?: ScanUsage };

/** 読み取れなかった（利用者に見せる文言を持つ）。回数には数えない */
export class ReceiptScanError extends Error {
  constructor(
    message: string,
    public readonly status: number = 422,
  ) {
    super(message);
    this.name = "ReceiptScanError";
  }
}

/**
 * 読み取り結果を整える。日付は実在する YYYY-MM-DD だけ、合計は正の整数だけを残す
 * （読み取りの誤りでフォームに不正な値が入らないように）。
 */
export function normalizeDraft(draft: ReceiptDraft): ReceiptDraft {
  return {
    date: validIsoDate(draft.date) ? draft.date : null,
    merchant: draft.merchant?.trim() || null,
    total:
      draft.total !== null && Number.isInteger(draft.total) && draft.total > 0 ? draft.total : null,
    items: draft.items
      .filter((i) => i.name.trim() !== "" && Number.isInteger(i.amount))
      .map((i) => ({ ...i, selfMedication: i.selfMedication === true })),
    selfMedicationTotal:
      draft.selfMedicationTotal !== null &&
      Number.isInteger(draft.selfMedicationTotal) &&
      draft.selfMedicationTotal > 0
        ? draft.selfMedicationTotal
        : null,
    paymentMethod: draft.paymentMethod,
  };
}

export { selfMedicationOf } from "@/lib/shared/self-medication";

function validIsoDate(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
