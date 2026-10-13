// OCR（Tesseract）で読んだレシートの文字から、日付・店名・合計・支払方法を拾う。
// 文字の読み違いが多いので、確かな手がかり（「合計」の行など）があるものだけを返し、無ければ null にする。
import type { PaymentMethod, ReceiptDraft } from "@/lib/ledger/receipt-scan/types";

/**
 * 全角の数字・記号を半角にし、日本語の文字のあいだに入った空白を詰める
 * （Tesseract の日本語は、1 文字ずつ空白を挟んで返すことが多い）。
 */
export function normalizeOcrText(text: string): string {
  const CJK = "\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef";
  return text
    .normalize("NFKC")
    .replace(/\\/g, "¥") // 円記号がバックスラッシュで読まれることがある
    .split("\n")
    .map((line) =>
      line
        .replace(new RegExp(`(?<=[${CJK}]) +(?=[${CJK}])`, "g"), "")
        .replace(/(?<=\d) *([,.]) *(?=\d)/g, "$1") // 「1 , 280」→「1,280」
        .replace(/(?<=[¥]) +/g, "")
        .trim(),
    )
    .filter((line) => line !== "")
    .join("\n");
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** レシートの日付（YYYY-MM-DD）。見つからなければ null（実在しない日付は呼び出し側で落とす） */
export function findReceiptDate(text: string): string | null {
  // 2026年10月13日 / 2026/10/13 / 2026-10-13 / 2026.10.13
  let m = text.match(/(20\d{2}) *[年/.-] *(\d{1,2}) *[月/.-] *(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // 令和8年10月13日 / R8.10.13（令和 n 年 = 2018 + n 年）
  m = text.match(/(?:令和|R) *(\d{1,2}) *[年/.-] *(\d{1,2}) *[月/.-] *(\d{1,2})/);
  if (m) return iso(2018 + Number(m[1]), Number(m[2]), Number(m[3]));
  // 26/10/13（年が 2 桁）
  m = text.match(/(?<!\d)(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)/);
  if (m) return iso(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// 合計の行の手がかり。小計・お預り・お釣り・税の内訳の行は合計ではない
const TOTAL_KEYWORDS = /(?:総?合計|お買上げ?(?:計|金額)?|お買い上げ|ご請求額|お支払い?金額)/;
const NOT_TOTAL = /(?:小計|預|釣|対象|消費税|内税|外税|税額|点数|ポイント)/;

function lastAmount(line: string): number | null {
  const nums = line.match(/\d{1,3}(?:,\d{3})+|\d+/g);
  if (!nums) return null;
  const n = Number(nums[nums.length - 1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 支払った合計（「合計」などの行の金額。金額が次の行にあることもある） */
export function findReceiptTotal(text: string): number | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!TOTAL_KEYWORDS.test(line) || NOT_TOTAL.test(line)) continue;
    const amount = lastAmount(line.replace(TOTAL_KEYWORDS, " "));
    if (amount !== null) return amount;
    const next = lines[i + 1];
    if (next && !NOT_TOTAL.test(next) && /^[¥\d,\s円]+$/.test(next)) return lastAmount(next);
  }
  return null;
}

const NOT_MERCHANT =
  /(?:領収|レシート|電話|TEL|〒|登録番号|\d{2,4}-\d{2,4}-\d{3,4}|\d{4}[年/.-]|様|毎度|ありがとう|いらっしゃい)/i;

/** 店名（上のほうの、店名らしい最初の行） */
export function findMerchant(text: string): string | null {
  for (const line of text.split("\n").slice(0, 8)) {
    const letters = line.replace(/[\d\s¥,.:/()\-*#]/g, "");
    if (letters.length < 2 || NOT_MERCHANT.test(line)) continue;
    return line.replace(/\s+/g, " ").trim();
  }
  return null;
}

/** 支払方法（印字の手がかりから。カード・電子マネーの手がかりを現金より先に見る） */
export function findPaymentMethod(raw: string): PaymentMethod {
  // ポイントカードは支払方法ではない（現金のレシートにもよく出る）
  const text = raw.replace(/ポイントカード/g, "");
  if (/クレジット|カード|VISA|JCB|Master|AMEX|ダイナース/i.test(text)) return "card";
  if (
    /電子マネー|Suica|PASMO|ICOCA|nanaco|WAON|楽天Edy|QUICPay|PayPay|d払い|auPAY|au PAY|楽天ペイ|メルペイ|iD/.test(
      text,
    )
  ) {
    return "emoney";
  }
  if (/現金|お預り|お預かり|お釣/.test(text)) return "cash";
  return "unknown";
}

/** OCR の文字からレシートの下書きを作る（品目は読み違いが多いので拾わない） */
export function parseReceiptText(raw: string): ReceiptDraft {
  const text = normalizeOcrText(raw);
  return {
    date: findReceiptDate(text),
    merchant: findMerchant(text),
    total: findReceiptTotal(text),
    items: [],
    paymentMethod: findPaymentMethod(text),
  };
}
