import { describe, it, expect } from "vitest";
import {
  classifyFileType,
  contentTypeForExtension,
  matchesMagicBytes,
  resolveUploadExtension,
} from "./upload";

describe("resolveUploadExtension", () => {
  it("許可された拡張子・MIME タイプの組は拡張子を返す", () => {
    expect(resolveUploadExtension("receipt.pdf", "application/pdf")).toBe("pdf");
    expect(resolveUploadExtension("photo.JPG", "image/jpeg")).toBe("jpg");
    expect(resolveUploadExtension("photo.png", "image/png")).toBe("png");
  });

  it("許可されていない拡張子は null", () => {
    expect(resolveUploadExtension("script.html", "text/html")).toBeNull();
    expect(resolveUploadExtension("archive.zip", "application/zip")).toBeNull();
  });

  it("拡張子と MIME タイプの詐称（偽装）を検出する", () => {
    // .png と自称しているが実体は HTML という偽装ケース
    expect(resolveUploadExtension("evil.png", "text/html")).toBeNull();
    expect(resolveUploadExtension("evil.pdf", "image/png")).toBeNull();
  });

  it("拡張子なしファイルは null", () => {
    expect(resolveUploadExtension("noext", "application/pdf")).toBeNull();
  });
});

describe("contentTypeForExtension", () => {
  it("既知拡張子は対応する MIME タイプを返す", () => {
    expect(contentTypeForExtension("pdf")).toBe("application/pdf");
    expect(contentTypeForExtension("PNG")).toBe("image/png");
  });

  it("未知拡張子は octet-stream", () => {
    expect(contentTypeForExtension("xyz")).toBe("application/octet-stream");
  });
});

describe("classifyFileType", () => {
  it("image/* は image、application/pdf は pdf、それ以外は other", () => {
    expect(classifyFileType("image/jpeg")).toBe("image");
    expect(classifyFileType("application/pdf")).toBe("pdf");
    expect(classifyFileType("application/octet-stream")).toBe("other");
  });
});

describe("matchesMagicBytes (S-8)", () => {
  it("正しいマジックバイトを持つファイルは true", () => {
    expect(matchesMagicBytes(Buffer.from("%PDF-1.4 ..."), "pdf")).toBe(true);
    expect(matchesMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "jpg")).toBe(true);
    expect(matchesMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "jpeg")).toBe(true);
    expect(
      matchesMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]), "png"),
    ).toBe(true);
    expect(matchesMagicBytes(Buffer.from("GIF89a...."), "gif")).toBe(true);
    expect(matchesMagicBytes(Buffer.from("GIF87a...."), "gif")).toBe(true);
    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP"),
    ]);
    expect(matchesMagicBytes(webp, "webp")).toBe(true);
  });

  it("拡張子を詐称した中身（例: HTML を .pdf と主張）は false", () => {
    expect(matchesMagicBytes(Buffer.from("<html><script>evil()</script></html>"), "pdf")).toBe(
      false,
    );
    expect(matchesMagicBytes(Buffer.from("<html>"), "jpg")).toBe(false);
    expect(matchesMagicBytes(Buffer.from("MZ\x90\x00"), "png")).toBe(false); // Windows PE 実行ファイルの先頭
  });

  it("未知の拡張子は false", () => {
    expect(matchesMagicBytes(Buffer.from("%PDF-"), "exe")).toBe(false);
  });

  it("バッファがシグネチャより短い場合は false", () => {
    expect(matchesMagicBytes(Buffer.from("PD"), "pdf")).toBe(false);
    expect(matchesMagicBytes(Buffer.alloc(0), "png")).toBe(false);
  });
});
