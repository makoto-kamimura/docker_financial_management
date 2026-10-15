// 申告書の転記用の中身（./build.ts）を A4 の PDF にする。日本語は BIZ UDゴシック（SIL OFL、assets/fonts）。
// 様式そのものではなく、欄の番号・名前・値を様式の順に並べた下書き。
// フォントは使う文字だけに減らしてから埋め込む。pdf-lib（fontkit）の subset はこのフォントで一部の字形が
// 描かれなくなるため、HarfBuzz（subset-font）で減らしたフォントを subset なしで埋め込む。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import subsetFont from "subset-font";
import { FORM_DISCLAIMER, NUMBER_NOTE, type FormDoc, type FormRow, type FormTable } from "./build";

const FONT_PATH = path.join(process.cwd(), "assets", "fonts", "BIZUDGothic-Regular.ttf");

let fontBytes: Promise<Buffer> | null = null;
const loadFont = () => (fontBytes ??= readFile(FONT_PATH));

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const WIDTH = A4[0] - MARGIN * 2;
const COLOR = {
  text: rgb(0.12, 0.16, 0.23),
  sub: rgb(0.4, 0.45, 0.53),
  line: rgb(0.85, 0.87, 0.9),
  band: rgb(0.94, 0.95, 0.97),
  accent: rgb(0.31, 0.27, 0.9),
};

/** 幅に収まるよう 1 文字ずつ折り返す（日本語は単語の区切りが無いため） */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line !== "" && font.widthOfTextAtSize(line + ch, size) > width) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  private pageNo = 0;

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private footer: string,
  ) {}

  newPage(title: string) {
    this.page = this.doc.addPage(A4);
    this.pageNo += 1;
    this.y = A4[1] - MARGIN;
    this.page.drawText(`${this.footer}　${this.pageNo}`, {
      x: MARGIN,
      y: MARGIN / 2,
      size: 7,
      font: this.font,
      color: COLOR.sub,
    });
    this.text(title, { size: 14 });
    this.y -= 4;
  }

  /** 残りの高さが足りなければ改ページする */
  ensure(height: number, title: string) {
    if (this.y - height < MARGIN) this.newPage(`${title}（続き）`);
  }

  text(
    s: string,
    opts: { size?: number; x?: number; width?: number; color?: ReturnType<typeof rgb> } = {},
  ) {
    const size = opts.size ?? 9;
    const x = opts.x ?? MARGIN;
    for (const line of wrap(s, this.font, size, opts.width ?? WIDTH - (x - MARGIN))) {
      this.y -= size * 1.45;
      this.page.drawText(line, {
        x,
        y: this.y,
        size,
        font: this.font,
        color: opts.color ?? COLOR.text,
      });
    }
  }

  note(s: string) {
    this.text(s, { size: 7.5, color: COLOR.sub });
  }

  band(title: string, pageTitle: string) {
    this.ensure(40, pageTitle);
    this.y -= 8;
    const h = 16;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - h,
      width: WIDTH,
      height: h,
      color: COLOR.band,
    });
    this.page.drawText(title, {
      x: MARGIN + 6,
      y: this.y - h + 4.5,
      size: 9.5,
      font: this.font,
      color: COLOR.text,
    });
    this.y -= h;
  }

  row(r: FormRow, pageTitle: string) {
    const size = 9;
    const noW = 46;
    const valueW = 130;
    const labelW = WIDTH - noW - valueW - 12;
    const labelLines = wrap(r.label, this.font, size, labelW);
    const noteLines = r.note ? wrap(r.note, this.font, 7, labelW) : [];
    const height = labelLines.length * size * 1.45 + noteLines.length * 7 * 1.4 + 6;
    this.ensure(height, pageTitle);
    const top = this.y;
    if (r.no) {
      this.page.drawText(r.no, {
        x: MARGIN + 4,
        y: top - size * 1.3,
        size,
        font: this.font,
        color: COLOR.accent,
      });
    }
    let y = top;
    for (const line of labelLines) {
      y -= size * 1.45;
      this.page.drawText(line, { x: MARGIN + noW, y, size, font: this.font, color: COLOR.text });
    }
    for (const line of noteLines) {
      y -= 7 * 1.4;
      this.page.drawText(line, { x: MARGIN + noW, y, size: 7, font: this.font, color: COLOR.sub });
    }
    const value = r.value ?? "";
    if (value !== "") {
      const vw = Math.min(this.font.widthOfTextAtSize(value, size + 1), valueW);
      this.page.drawText(value, {
        x: MARGIN + WIDTH - vw - 4,
        y: top - size * 1.35,
        size: size + 1,
        font: this.font,
        color: COLOR.text,
        maxWidth: valueW,
      });
    }
    this.y = y - 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 2 },
      end: { x: MARGIN + WIDTH, y: this.y + 2 },
      thickness: 0.5,
      color: COLOR.line,
    });
  }

  table(t: FormTable, pageTitle: string) {
    const size = 8;
    const total = t.widths.reduce((s, w) => s + w, 0);
    const widths = t.widths.map((w) => (w / total) * WIDTH);
    const drawRow = (cells: string[], header: boolean) => {
      const lines = cells.map((c, i) => wrap(c, this.font, size, widths[i] - 6));
      const h = Math.max(1, ...lines.map((l) => l.length)) * size * 1.4 + 6;
      this.ensure(h, pageTitle);
      if (header) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - h,
          width: WIDTH,
          height: h,
          color: COLOR.band,
        });
      }
      let x = MARGIN;
      lines.forEach((ls, i) => {
        let y = this.y - 3;
        // 金額（「円」で終わる値）は右に寄せる
        const right = !header && /円$/.test(cells[i]);
        for (const line of ls) {
          y -= size * 1.4;
          const lw = this.font.widthOfTextAtSize(line, size);
          this.page.drawText(line, {
            x: right ? x + widths[i] - lw - 3 : x + 3,
            y: y + 2,
            size,
            font: this.font,
            color: header ? COLOR.sub : COLOR.text,
          });
        }
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: MARGIN + WIDTH, y: this.y },
        thickness: 0.5,
        color: COLOR.line,
      });
    };
    drawRow(t.columns, true);
    if (t.rows.length === 0) {
      this.text("（該当なし）", { size: 8, color: COLOR.sub });
      this.y -= 4;
    }
    for (const r of t.rows) drawRow(r, false);
  }
}

// 中身のほかに PDF に描く文字（ページ番号・続き・該当なし・作成日など）
const FIXED_TEXT =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  "　（）・、。〜円年月日分の続き該当なし作成日転記用下書";

/** 申告書（1 つ以上）を 1 つの PDF にする */
export async function renderFormsPdf(
  docs: FormDoc[],
  opts: { createdAt?: Date } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const text = FIXED_TEXT + FORM_DISCLAIMER + NUMBER_NOTE + JSON.stringify(docs);
  const glyphs = await subsetFont(await loadFont(), text, { targetFormat: "truetype" });
  const font = await pdf.embedFont(glyphs, { subset: false });
  const created = (opts.createdAt ?? new Date()).toISOString().slice(0, 10);
  pdf.setTitle(docs.map((d) => d.title).join("・"));
  pdf.setCreationDate(opts.createdAt ?? new Date());
  const w = new Writer(pdf, font, `転記用の下書き（作成日 ${created}）`);
  for (const doc of docs) {
    for (const page of doc.pages) {
      w.newPage(page.title);
      w.note(FORM_DISCLAIMER);
      if (doc.key === "return-1" || doc.key === "return-2") w.note(NUMBER_NOTE);
      for (const section of page.sections) {
        w.band(section.title, page.title);
        for (const r of section.rows ?? []) w.row(r, page.title);
        if (section.table) w.table(section.table, page.title);
        if (section.note) w.note(section.note);
      }
    }
  }
  return pdf.save();
}
