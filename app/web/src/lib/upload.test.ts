import { describe, it, expect } from "vitest";
import { classifyFileType, contentTypeForExtension, resolveUploadExtension } from "./upload";

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
