// OCR で読んだレシートの文字から、日付・店名・合計・支払方法を拾う。
// 文字の読み違いがあるので、確かな手がかり（「合計」の行など）があるものだけを返し、無ければ null にする。
// OCR サービス（PaddleOCR）で読んだときは、行ごとの文字の高さ（height）も手がかりにする
// （店名と合計は大きい字で印字されることが多い）。Tesseract の文字だけのときは、高さなしで同じ処理をする。
import type { PaymentMethod, ReceiptDraft } from "@/lib/ledger/receipt-scan/types";

/** 1 行の文字（height は文字の高さ。分からなければ無し） */
export type TextLine = { text: string; height?: number };

// PaddleOCR は中国語と同じモデルで読むので、日本語の字を中国語の字体で返すことがある（対→对 など）。
// 日本語のレシートには出てこない字体だけを、日本語の字に戻す
const CJK_VARIANTS: Record<string, string> = {
  对: "対",
  费: "費",
  计: "計",
  额: "額",
  预: "預",
  现: "現",
  买: "買",
  单: "単",
  东: "東",
  时: "時",
  间: "間",
  员: "員",
  发: "発",
  门: "門",
  总: "総",
  综: "総",
  线: "線",
  钱: "銭",
  银: "銀",
  贵: "貴",
  货: "貨",
  价: "価",
  帐: "帳",
  账: "帳",
  记: "記",
  认: "認",
  请: "請",
  领: "領",
  证: "証",
  补: "補",
  业: "業",
  务: "務",
  电: "電",
  话: "話",
  优: "優",
  减: "減",
  积: "積",
  应: "応",
  实: "実",
  际: "際",
  车: "車",
  营: "営",
  药: "薬",
  疗: "療",
  剂: "剤",
  处: "処",
  个: "個",
  张: "張",
  纳: "納",
  种: "種",
  类: "類",
  产: "産",
  綠: "緑",
  藥: "薬",
  對: "対",
  圓: "円",
  價: "価",
  稅: "税",
  點: "点",
  會: "会",
  錢: "銭",
  證: "証",
  營: "営",
  號: "号",
  讀: "読",
  劑: "剤",
  负: "負",
  查: "査",
  專: "専",
  檢: "検",
  醫: "医",
  齒: "歯",
  數: "数",
  內: "内",
  總: "総",
  險: "険",
  處: "処",
  縣: "県",
};
const CJK_VARIANT_RE = new RegExp(`[${Object.keys(CJK_VARIANTS).join("")}]`, "g");

/**
 * 1 行を整える。全角の数字・記号を半角にし、日本語の文字のあいだに入った空白を詰め、
 * 中国語の字体を日本語の字に戻す（Tesseract の日本語は、1 文字ずつ空白を挟んで返すことが多い）。
 */
export function normalizeOcrLine(line: string): string {
  const CJK = "\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef";
  return line
    .normalize("NFKC")
    .replace(/\\/g, "¥") // 円記号がバックスラッシュで読まれることがある
    .replace(CJK_VARIANT_RE, (c) => CJK_VARIANTS[c] ?? c)
    .replace(new RegExp(`(?<=[${CJK}]) +(?=[${CJK}])`, "g"), "")
    .replace(/(?<=\d) *([,.]) *(?=\d)/g, "$1") // 「1 , 280」→「1,280」
    .replace(/(?<=[¥]) +/g, "")
    .trim();
}

/** 文字全体を整える（空の行は落とす） */
export function normalizeOcrText(text: string): string {
  return text
    .split("\n")
    .map(normalizeOcrLine)
    .filter((line) => line !== "")
    .join("\n");
}

function toLines(input: string | TextLine[]): TextLine[] {
  return typeof input === "string" ? input.split("\n").map((text) => ({ text })) : input;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// 領収した日ではない日付の行（医療の領収書の生年月日・次回の予約、クーポンの有効期限など）
const NOT_RECEIPT_DATE = /(?:生年月日|誕生|次回|予約|有効期限|期限|まで有効)/;

/**
 * レシートの日付（YYYY-MM-DD）。見つからなければ null（実在しない日付は呼び出し側で落とす）。
 * 生年月日・次回の予約・有効期限の行の日付は使わない（ほかに日付が無いときだけ使う）
 */
export function findReceiptDate(input: string | TextLine[]): string | null {
  const lines = toLines(input).map((l) => l.text);
  return (
    dateIn(lines.filter((l) => !NOT_RECEIPT_DATE.test(l)).join("\n")) ?? dateIn(lines.join("\n"))
  );
}

function dateIn(text: string): string | null {
  // 2026年10月13日 / 2026/10/13 / 2026-10-13 / 2026.10.13
  let m = text.match(/(20\d{2}) *[年/.-] *(\d{1,2}) *[月/.-] *(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // 令和8年10月13日 / R8.10.13（令和 n 年 = 2018 + n 年）
  m = text.match(/(?:令和|R) *(\d{1,2}) *[年/.-] *(\d{1,2}) *[月/.-] *(\d{1,2})/);
  if (m) return iso(2018 + Number(m[1]), Number(m[2]), Number(m[3]));
  // 26/10/13（年が 2 桁）。日付と時刻のあいだの空白が読めず「26/10/1312:34」になることがある
  m = text.match(/(?<!\d)(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})(?=\d{1,2}:\d{2}|(?!\d))/);
  if (m) return iso(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// 合計の行の手がかり。小計・お預り・お釣り・税の内訳・残高の行は合計ではない
// 医療の領収書は「領収金額」「今回領収額」「お支払額」（「合計」の行は点数のことが多い）
const TOTAL_KEYWORDS =
  /(?:総?合計(?:金額)?|お?会計|お買上げ?(?:計|金額|合計)?|お買い上げ(?:計|金額)?|ご?請求(?:額|金額)|お?支払い?(?:金額|額|合計)|ご利用(?:金額|額)|(?:今回)?領収(?:金)?額|税込合計)/;
const NOT_TOTAL = /(?:小計|預|釣|対象|消費税|内税|外税|税額|税率|点数|ポイント|残高|値引|割引)/;
// 支払いの行（電子マネー・カードの金額は、支払った合計と同じことが多い）
const PAID_LINE =
  /(?:クレジット|カード|電子マネー|交通系|IC支払|Suica|PASMO|ICOCA|nanaco|WAON|Edy|QUICPay|PayPay|d払い|au ?PAY|楽天ペイ|メルペイ|iD|コード決済|支払)/i;

function lastAmount(line: string): number | null {
  // 「696点」のような点数（医療の領収書）は金額ではない
  const nums = line.replace(/[\d,]+\s*点/g, " ").match(/\d{1,3}(?:,\d{3})+|\d+/g);
  if (!nums) return null;
  const n = Number(nums[nums.length - 1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 金額だけの行か（「合計」の金額が次の行に分かれて読まれることがある） */
const AMOUNT_ONLY = /^[¥\d,\s円]+$/;

/** 「お預り」−「お釣り」（現金払いのとき、支払った合計と同じになる） */
function cashTotal(lines: TextLine[]): number | null {
  let paid: number | null = null;
  let change: number | null = null;
  for (const { text } of lines) {
    if (/預/.test(text)) paid ??= lastAmount(text);
    else if (/釣/.test(text)) change ??= /¥0\b|\b0円/.test(text) ? 0 : lastAmount(text);
  }
  if (paid === null || change === null || paid <= change) return null;
  return paid - change;
}

/**
 * 支払った合計。「合計」などの行の金額（金額が次の行・前の行にあることもある）。
 * 手がかりの行がいくつかあれば、大きい字の行（分からなければ上の行）を選ぶ。
 * 現金払いで「お預り」と「お釣り」が読めていれば、その差と合う行を選び、手がかりの行が無ければ差を使う。
 */
export function findReceiptTotal(input: string | TextLine[]): number | null {
  const lines = toLines(input);
  const candidates: { amount: number; height: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    if (!TOTAL_KEYWORDS.test(line) || NOT_TOTAL.test(line)) continue;
    let amount = lastAmount(line.replace(TOTAL_KEYWORDS, " "));
    let height = lines[i].height ?? 0;
    // 金額が次の行（表や枠の中では、傾きで前の行）に分かれて読まれることがある
    for (const near of [lines[i + 1], lines[i - 1]]) {
      if (amount !== null || !near || NOT_TOTAL.test(near.text) || !AMOUNT_ONLY.test(near.text)) {
        continue;
      }
      amount = lastAmount(near.text);
      height = Math.max(height, near.height ?? 0);
    }
    if (amount !== null) candidates.push({ amount, height });
  }
  const cash = cashTotal(lines);
  if (cash !== null) {
    if (candidates.length === 0 || candidates.some((c) => c.amount === cash)) return cash;
  }
  if (candidates.length > 0) {
    // 大きい字の行を選ぶ（高さが同じ・分からなければ、先に出てきた行）
    return candidates.reduce((best, c) => (c.height > best.height * 1.15 ? c : best)).amount;
  }
  // 手がかりの行が無ければ、カード・電子マネーの支払いの行の金額
  for (const { text } of lines) {
    if (PAID_LINE.test(text) && !NOT_TOTAL.test(text) && !/ポイントカード/.test(text)) {
      const amount = lastAmount(text);
      if (amount !== null && /[¥円]|\d,\d{3}/.test(text)) return amount;
    }
  }
  return null;
}

const NOT_MERCHANT =
  /(?:領収|レシート|電話|TEL|FAX|〒|登録番号|\d{2,4}-\d{2,4}-\d{3,4}|\d{4}[年/.-]|(?:令和|平成|昭和)\s*\d|様|毎度|ありがとう|いらっしゃい|ご来店|営業時間|責No|レジ|担当|患者|番号|氏名|割合|(?:¥\s*[\d,]+|[\d,]+\s*円)\s*$)/i;
// 住所（県名で始まる・番地がある）。店名の候補にしない
const ADDRESS = /^(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)|\d+[-‐−ー]\d+/;
// 店名の行の終わりの支店名（「スーパーマルヤマ 中央店」の「中央店」）。家計簿の摘要と学習ルールでは店名だけを使う
// 「書店」「本店」のような 1 文字＋店は店名の一部のことが多いので、2 文字以上＋店だけを支店名とみなす
const BRANCH_SUFFIX = /\s+\S{2,8}(?:店|支店|営業所)$/;

// 名前の前の法人名（「医療法人社団 青葉会 みどりクリニック」の「医療法人社団 青葉会」）
// 空白が読めずに続いたときは、「〜会」までを法人名とみなす（「医療法人若葉会わかば歯科クリニック」）
const CORPORATE_PREFIX =
  /^(?:(?:社会)?医療法人(?:社団|財団)?|(?:一般|公益)(?:社団|財団)法人|(?:株式|有限|合同)会社)(?:\s*\S*\s+|\S+?会(?=\S))/;

function merchantName(line: string): string {
  let name = line.replace(/\s+/g, " ").trim();
  // 後ろの短い切れ端が名前の字ばかりなら、名前に重なった印（判子）の字なので落とす（「あすなろ眼科 あす」）
  const tail = name.match(/\s(\S{1,3})$/);
  if (tail && [...tail[1]].every((c) => name.slice(0, -tail[0].length).includes(c))) {
    name = name.slice(0, -tail[0].length);
  }
  const trimmed = name.replace(CORPORATE_PREFIX, "").replace(BRANCH_SUFFIX, "");
  return trimmed.replace(/[\d\s¥,.:/()\-*#]/g, "").length >= 2 ? trimmed : name;
}

// 医療の領収書（病院・診療所・歯科・薬局）の手がかりと、医療機関名の行の手がかり。
// 医療の領収書は、医療機関名を下のほう（発行日の近く）に印字することが多い
const MEDICAL_RECEIPT = /(?:患者|保険|点数|負担割合|調剤|受診日|診療日|初・?再診料|処方)/;
const FACILITY =
  /(?:病院|医院|クリニック|診療所|歯科|薬局|調剤|整形外科|内科|外科|皮膚科|眼科|耳鼻咽喉科|小児科|婦人科|泌尿器科|心療内科|メディカル|ファーマシー|整骨院|接骨院|鍼灸)/;
// 表の見出し（「精神科専門療法」「調剤技術料」「調剤日」など）は医療機関名ではない。
// 「朝日クリニック」「〇〇保険薬局」のような名前を落とさないよう、「日」「保険」だけでは除かない
const NOT_FACILITY =
  /(?:(?<!医)療法|料|管理|点|割合|患者|負担|(?:受診|調剤|診療|発行|領収|処方)日|様)/;

function findFacility(lines: TextLine[]): string | null {
  const found = lines.filter(
    ({ text }) =>
      FACILITY.test(text) &&
      !NOT_FACILITY.test(text) &&
      !NOT_MERCHANT.test(text) &&
      !ADDRESS.test(text),
  );
  if (found.length === 0) return null;
  // 大きい字の行（高さが分からなければ、下のほうの行）
  const best = found.reduce((a, b) => ((b.height ?? 0) >= (a.height ?? 0) ? b : a));
  return merchantName(dropStampAfterSuffix(best.text));
}

/** 「〜クリニック」の後ろに空白なしで続いた、名前の字ばかりの短い切れ端（印の字）を落とす */
function dropStampAfterSuffix(text: string): string {
  const matches = [...text.matchAll(new RegExp(FACILITY.source, "g"))];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return text;
  const end = last.index + last[0].length;
  const tail = text.slice(end);
  const head = text.slice(0, end);
  return tail.length >= 1 && tail.length <= 3 && [...tail].every((c) => head.includes(c))
    ? head
    : text;
}

/**
 * 店名。上のほう（最初の 8 行）の、店名らしい行。文字の高さが分かれば、まわりより大きい字の行を選ぶ
 * （ロゴの下の店名は大きく印字される）。大きい行が無ければ、店名らしい最初の行。
 * 医療の領収書なら、どこにあっても医療機関名（「〜クリニック」「〜薬局」など）の行を選ぶ。
 */
export function findMerchant(input: string | TextLine[]): string | null {
  const all = toLines(input);
  if (all.some(({ text }) => MEDICAL_RECEIPT.test(text))) {
    const facility = findFacility(all);
    if (facility) return facility;
  }
  const top = all.slice(0, 8);
  const plausible = top.filter(({ text }) => {
    const letters = text.replace(/[\d\s¥,.:/()\-*#]/g, "");
    return letters.length >= 2 && !NOT_MERCHANT.test(text) && !ADDRESS.test(text);
  });
  if (plausible.length === 0) return null;
  const heights = toLines(input)
    .map((l) => l.height)
    .filter((h): h is number => typeof h === "number" && h > 0)
    .sort((a, b) => a - b);
  if (heights.length >= 3) {
    const median = heights[Math.floor(heights.length / 2)];
    const big = plausible.find((l) => (l.height ?? 0) >= median * 1.3);
    if (big) return merchantName(big.text);
  }
  return merchantName(plausible[0].text);
}

const CARD = /クレジット|デビット|VISA|JCB|Master|AMEX|アメックス|ダイナース|Diners/i;
const EMONEY =
  /電子マネー|交通系|IC支払|Suica|PASMO|ICOCA|Kitaca|TOICA|manaca|SUGOCA|nimoca|PiTaPa|nanaco|WAON|Edy|QUICPay|PayPay|d払い|au ?PAY|楽天ペイ|メルペイ|LINE ?Pay|ゆうちょPay|コード決済|iD/;

/**
 * 支払方法（印字の手がかりから）。「お預り」と「お釣り」が両方あれば現金（カード・電子マネーにお釣りは無い。
 * 「PayPay 使えます」のような案内が下にあっても現金にする）。それ以外は、カード・電子マネーの手がかりを現金より先に見る
 */
export function findPaymentMethod(input: string | TextLine[]): PaymentMethod {
  // ポイントカードは支払方法ではない（現金のレシートにもよく出る）
  const text = toLines(input)
    .map((l) => l.text)
    .join("\n")
    .replace(/ポイントカード/g, "");
  if (/預/.test(text) && /釣/.test(text)) return "cash";
  if (CARD.test(text)) return "card";
  if (EMONEY.test(text)) return "emoney";
  if (/カード/.test(text)) return "card";
  if (/現金|お預り|お預かり|お釣/.test(text)) return "cash";
  return "unknown";
}

// セルフメディケーション税制の対象品の印（レシートの注記で示される。★ が多い）
const SELF_MED_MARK = /^[★☆◆◇■□●※]/;
const SELF_MED_NOTE = /(?:セルフ|メディケ|対象商品|印は|印の)/;

/**
 * セルフメディケーション税制の対象品（印の付いた品目の行）と、印字された対象額。
 * 「セルフメディケーション」の注記があるレシートだけを見る（印は店によって別の意味のこともあるため）
 */
export function findSelfMedication(input: string | TextLine[]): {
  items: ReceiptDraft["items"];
  total: number | null;
} {
  const lines = toLines(input).map((l) => l.text);
  if (!lines.some((l) => /セルフメディケ/.test(l))) return { items: [], total: null };
  const items: ReceiptDraft["items"] = [];
  let total: number | null = null;
  for (const line of lines) {
    if (/セルフメディケ/.test(line) && /(?:対象|額|計)/.test(line) && !SELF_MED_MARK.test(line)) {
      total ??= lastAmount(line);
      continue;
    }
    if (!SELF_MED_MARK.test(line) || SELF_MED_NOTE.test(line)) continue;
    const amount = lastAmount(line);
    const name = line
      .replace(SELF_MED_MARK, "")
      .replace(/[¥]?\d{1,3}(?:,\d{3})+\S*$|[¥]?\d+\S*$/, "")
      .trim();
    if (amount !== null && name !== "") items.push({ name, amount, selfMedication: true });
  }
  return { items, total };
}

/** 行（文字と高さ）からレシートの下書きを作る（品目は読み違いが多いので、セルフメディケーションの対象品だけ拾う） */
export function parseReceiptLines(raw: TextLine[]): ReceiptDraft {
  const lines = raw
    .map((l) => ({ text: normalizeOcrLine(l.text), height: l.height }))
    .filter((l) => l.text !== "");
  const selfMed = findSelfMedication(lines);
  return {
    date: findReceiptDate(lines),
    merchant: findMerchant(lines),
    total: findReceiptTotal(lines),
    items: selfMed.items,
    selfMedicationTotal: selfMed.total,
    paymentMethod: findPaymentMethod(lines),
  };
}

/** OCR の文字（改行区切り）からレシートの下書きを作る */
export function parseReceiptText(raw: string): ReceiptDraft {
  return parseReceiptLines(raw.split("\n").map((text) => ({ text })));
}
