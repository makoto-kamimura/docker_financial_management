import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrServiceUnavailable, readWithOcrService, type OcrReading } from "./ocr-service";
import { ReceiptScanError } from "./types";

const reading: OcrReading = {
  width: 600,
  height: 1400,
  cropped: true,
  rotation: 0,
  quality: { warnings: [] },
  lines: [{ text: "合計 ¥1,280", x0: 0, y0: 0, x1: 500, y1: 40, height: 40, score: 0.98 }],
  text: "合計 ¥1,280",
  model: "pp-ocr-v6-small",
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("readWithOcrService", () => {
  it("画像を送り、読み取り結果を返す", async () => {
    const fetchMock = respond(200, reading);
    vi.stubGlobal("fetch", fetchMock);
    await expect(readWithOcrService("http://ocr:8000", Buffer.from("jpeg"))).resolves.toEqual(
      reading,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://ocr:8000/v1/receipt?ocr=1&image=0");
    expect(init.method).toBe("POST");
  });

  it("切り抜きだけ・画像つきを頼める", async () => {
    const fetchMock = respond(200, reading);
    vi.stubGlobal("fetch", fetchMock);
    await readWithOcrService("http://ocr:8000", Buffer.from("jpeg"), { ocr: false, image: true });
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.search).toBe("?ocr=0&image=1");
  });

  it("届かなければ OcrServiceUnavailable（Tesseract で読み直す）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(readWithOcrService("http://ocr:8000", Buffer.from("x"))).rejects.toBeInstanceOf(
      OcrServiceUnavailable,
    );
  });

  it("時間切れは撮り直しの案内", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    await expect(readWithOcrService("http://ocr:8000", Buffer.from("x"))).rejects.toMatchObject({
      name: "ReceiptScanError",
      status: 422,
    });
  });

  it.each([
    [422, 422, "この画像は読み取れません"],
    [413, 422, "この画像は読み取れません"],
    [503, 503, "混み合っています"],
    [504, 422, "時間がかかりすぎました"],
    [500, 422, "読み取れませんでした"],
  ])("サービスの %i は、利用者に見せる文言の %i にする", async (status, want, message) => {
    vi.stubGlobal("fetch", respond(status, { error: "x" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await readWithOcrService("http://ocr:8000", Buffer.from("x")).catch((e) => e);
    expect(err).toBeInstanceOf(ReceiptScanError);
    expect(err.status).toBe(want);
    expect(err.message).toContain(message);
  });
});
