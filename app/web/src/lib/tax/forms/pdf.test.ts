import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderFormsPdf } from "./pdf";
import type { FormDoc } from "./build";

const doc = (pages: number, rows: number): FormDoc => ({
  key: "return-1",
  title: "確定申告書 第一表",
  group: "確定申告",
  needed: true,
  why: "",
  pages: Array.from({ length: pages }, (_, p) => ({
    title: `確定申告書 第一表（令和8年分）${p}`,
    sections: [
      {
        title: "所得から差し引かれる金額",
        rows: Array.from({ length: rows }, (_, i) => ({
          no: "⑬",
          label: `社会保険料控除 ${i}`,
          value: "533,868円",
          note: "給与から差し引かれた分",
        })),
        table: {
          columns: ["保険料等の種類", "支払保険料等の計"],
          widths: [5, 3],
          rows: [["健康保険", "182,340円"]],
        },
      },
    ],
  })),
});

describe("renderFormsPdf", () => {
  it("日本語の PDF を作り、申告書のページごとにページを分ける", async () => {
    const bytes = await renderFormsPdf([doc(2, 3)]);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(2);
    expect(back.getTitle()).toBe("確定申告書 第一表");
    // 使った文字だけを埋め込むので小さい
    expect(bytes.length).toBeLessThan(200_000);
  });

  it("1 ページに収まらない行は改ページする", async () => {
    const bytes = await renderFormsPdf([doc(1, 60)]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
