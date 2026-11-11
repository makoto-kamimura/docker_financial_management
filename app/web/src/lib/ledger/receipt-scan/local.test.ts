import { beforeEach, describe, expect, it, vi } from "vitest";

const { readWithOcrService, scanWithTesseract } = vi.hoisted(() => ({
  readWithOcrService: vi.fn(),
  scanWithTesseract: vi.fn(),
}));
vi.mock("./ocr-service", async (orig) => ({
  ...(await orig<typeof import("./ocr-service")>()),
  readWithOcrService,
}));
vi.mock("./tesseract", () => ({ scanWithTesseract }));

import { scanLocally } from "./local";
import { OcrServiceUnavailable } from "./ocr-service";
import { ReceiptScanError } from "./types";

const tesseractResult = {
  draft: {
    date: null,
    merchant: null,
    total: null,
    items: [],
    selfMedicationTotal: null,
    paymentMethod: "unknown" as const,
  },
  model: "tesseract.js",
};

beforeEach(() => {
  readWithOcrService.mockReset();
  scanWithTesseract.mockReset().mockResolvedValue(tesseractResult);
});

describe("scanLocally", () => {
  it("OCR サービスで読み、行から下書きを作る", async () => {
    readWithOcrService.mockResolvedValue({
      width: 600,
      height: 1400,
      cropped: true,
      rotation: 0,
      quality: { warnings: ["too_dark"] },
      lines: [
        { text: "ベーカリー麦の穂", height: 52 },
        { text: "駅前店", height: 24 },
        { text: "2026-04-24 11:44", height: 24 },
        { text: "合計 ¥2,060", height: 50 },
        { text: "お預り ¥3,000", height: 24 },
        { text: "お釣り ¥940", height: 24 },
      ],
      text: "",
      model: "pp-ocr-v6-small",
    });
    const result = await scanLocally(Buffer.from("x"), "http://ocr:8000");
    expect(result.draft).toMatchObject({
      date: "2026-04-24",
      merchant: "ベーカリー麦の穂",
      total: 2060,
      paymentMethod: "cash",
    });
    expect(result.model).toBe("pp-ocr-v6-small");
    expect(result.warnings).toEqual(["too_dark"]);
    expect(scanWithTesseract).not.toHaveBeenCalled();
  });

  it("サービスに届かなければ Tesseract で読む", async () => {
    readWithOcrService.mockRejectedValue(new OcrServiceUnavailable("ECONNREFUSED"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(scanLocally(Buffer.from("x"), "http://ocr:8000")).resolves.toBe(tesseractResult);
  });

  it("サービスが読めないと答えたときは、Tesseract で読み直さない", async () => {
    readWithOcrService.mockRejectedValue(new ReceiptScanError("この画像は読み取れません"));
    await expect(scanLocally(Buffer.from("x"), "http://ocr:8000")).rejects.toBeInstanceOf(
      ReceiptScanError,
    );
    expect(scanWithTesseract).not.toHaveBeenCalled();
  });

  it("サービスの設定が無ければ Tesseract で読む", async () => {
    await expect(scanLocally(Buffer.from("x"), undefined)).resolves.toBe(tesseractResult);
    expect(readWithOcrService).not.toHaveBeenCalled();
  });
});
