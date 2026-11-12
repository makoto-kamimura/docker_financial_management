// レシートの読み取りの精度を測る（無料プランの読み取り → 解析まで、本番と同じ処理で流す）。
// サンプルは app/ocr/scripts/receipt_eval.py synth で作る（xxx.jpg と正解の xxx.json）。手順は docs/runbooks/receipt-ocr.md。
//
//   npx tsx scripts/receipt-eval.ts --samples DIR [--engines tesseract,service]
//       [--ocr-url http://localhost:8000] [--max-edge 1600] [--out result.json] [--verbose]
//
// 写真はアプリと同じく長辺 --max-edge の JPEG（品質 0.85）に縮めてから読む（lib/client/resize-image.ts）。
// 見るのは 日付・店名・合計・支払方法・セルフメディケーションの対象額 が正解と合うかと、文字誤り率（CER）。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parseReceiptText } from "../src/lib/ledger/receipt-scan/parse-receipt-text";
import { draftFromReading } from "../src/lib/ledger/receipt-scan/local";
import { readWithOcrService } from "../src/lib/ledger/receipt-scan/ocr-service";
import { recognizeWithTesseract } from "../src/lib/ledger/receipt-scan/tesseract";
import { normalizeDraft, type ReceiptDraft } from "../src/lib/ledger/receipt-scan/types";

type Truth = {
  date: string;
  merchant: string;
  total: number;
  paymentMethod: ReceiptDraft["paymentMethod"];
  selfMedicationTotal: number | null;
  text?: string;
};
type Engine = "tesseract" | "service";
const FIELDS = ["date", "merchant", "total", "paymentMethod", "selfMedicationTotal"] as const;
type Field = (typeof FIELDS)[number];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 編集距離 ÷ 正解の文字数（空白・改行は除いて比べる） */
export function cer(ref: string, hyp: string): number {
  const a = [...norm(ref)];
  const b = [...norm(hyp)];
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] / a.length;
}

function correct(field: Field, truth: Truth, draft: ReceiptDraft): boolean {
  if (field === "merchant") {
    // 支店名が付いていてもよい（摘要として使える）。正解の店名を含んでいれば合っているとみなす
    const got = norm(draft.merchant);
    return got !== "" && got.includes(norm(truth.merchant));
  }
  return (draft[field] ?? null) === (truth[field] ?? null);
}

async function shrink(file: string, maxEdge: number): Promise<Buffer> {
  return sharp(file)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function read(
  engine: Engine,
  image: Buffer,
  ocrUrl: string,
): Promise<{ text: string; draft: ReceiptDraft; extra?: Record<string, unknown> }> {
  if (engine === "tesseract") {
    const text = await recognizeWithTesseract(image);
    return { text, draft: normalizeDraft(parseReceiptText(text)) };
  }
  const r = await readWithOcrService(ocrUrl, image);
  return {
    text: r.text,
    draft: draftFromReading(r),
    extra: { cropped: r.cropped, rotation: r.rotation, warnings: r.quality.warnings },
  };
}

async function main() {
  const dir = arg("samples");
  if (!dir) throw new Error("--samples DIR を指定してください");
  const engines = (arg("engines", "tesseract,service") ?? "").split(",") as Engine[];
  const ocrUrl = arg("ocr-url", "http://localhost:8000")!;
  const maxEdge = Number(arg("max-edge", "1600"));
  const verbose = process.argv.includes("--verbose");
  const samples = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        /\.(jpe?g|png)$/i.test(f) && fs.existsSync(path.join(dir, f.replace(/\.\w+$/, ".json"))),
    )
    .sort();

  const rows: Record<string, unknown>[] = [];
  for (const engine of engines) {
    const hits: Record<Field | "all" | "merchantExact", number> = {
      date: 0,
      merchant: 0,
      merchantExact: 0,
      total: 0,
      paymentMethod: 0,
      selfMedicationTotal: 0,
      all: 0,
    };
    let cerSum = 0;
    let cerN = 0;
    let ms = 0;
    for (const file of samples) {
      const truth = JSON.parse(
        fs.readFileSync(path.join(dir, file.replace(/\.\w+$/, ".json")), "utf8"),
      ) as Truth;
      const image = await shrink(path.join(dir, file), maxEdge);
      const started = Date.now();
      let result: Awaited<ReturnType<typeof read>>;
      try {
        result = await read(engine, image, ocrUrl);
      } catch (e) {
        console.error(`${engine} ${file}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      ms += Date.now() - started;
      const ok = Object.fromEntries(
        FIELDS.map((f) => [f, correct(f, truth, result.draft)]),
      ) as Record<Field, boolean>;
      for (const f of FIELDS) if (ok[f]) hits[f]++;
      // 店名は「正解を含む」で数えるが、余計な字（支店名・印の字）が付いていないかも見る
      if (norm(result.draft.merchant) === norm(truth.merchant)) hits.merchantExact++;
      if (ok.date && ok.merchant && ok.total && ok.paymentMethod) hits.all++;
      const c = truth.text ? cer(truth.text, result.text) : null;
      if (c !== null) {
        cerSum += c;
        cerN++;
      }
      rows.push({
        engine,
        file,
        ok,
        cer: c,
        draft: result.draft,
        truth,
        ...result.extra,
        text: result.text,
      });
      if (verbose) {
        const miss = FIELDS.filter((f) => !ok[f]).map(
          (f) => `${f}=${JSON.stringify(result.draft[f])}(正解 ${JSON.stringify(truth[f])})`,
        );
        console.log(`${engine} ${file} cer=${c?.toFixed(3)} ${miss.join(" ") || "ok"}`);
      }
    }
    const n = samples.length;
    const pct = (k: number) => `${((100 * k) / n).toFixed(0)}%`.padStart(5);
    console.log(
      `${engine.padEnd(10)} n=${n} 日付${pct(hits.date)} 店名${pct(hits.merchant)}（完全一致${pct(hits.merchantExact)}） 合計${pct(hits.total)}` +
        ` 支払${pct(hits.paymentMethod)} セルフメディ${pct(hits.selfMedicationTotal)} 4項目すべて${pct(hits.all)}` +
        ` CER ${cerN ? ((100 * cerSum) / cerN).toFixed(1) : "-"}% 1枚 ${(ms / n / 1000).toFixed(1)}秒`,
    );
  }
  const out = arg("out");
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
