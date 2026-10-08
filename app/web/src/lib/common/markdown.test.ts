import { describe, expect, it } from "vitest";
import { parseFrontmatter, renderMarkdownToHtml } from "./markdown";

describe("parseFrontmatter", () => {
  it("フロントマターと本文を分離する", () => {
    const raw = `---\ntitle: テスト\norder: 1\nrelatedPath: /closing\nrelatedLabel: 決算書を見る\n---\n本文です`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({
      title: "テスト",
      order: "1",
      relatedPath: "/closing",
      relatedLabel: "決算書を見る",
    });
    expect(body).toBe("本文です");
  });

  it("フロントマターが無い場合は title 空・本文はそのまま", () => {
    const { frontmatter, body } = parseFrontmatter("ただの本文");
    expect(frontmatter.title).toBe("");
    expect(body).toBe("ただの本文");
  });
});

describe("renderMarkdownToHtml", () => {
  it("見出しを h1〜h4 に変換する", () => {
    expect(renderMarkdownToHtml("# 見出し1")).toBe("<h1>見出し1</h1>");
    expect(renderMarkdownToHtml("## 見出し2")).toBe("<h2>見出し2</h2>");
    expect(renderMarkdownToHtml("#### 見出し4")).toBe("<h4>見出し4</h4>");
  });

  it("段落を p タグに変換し複数行は連結する", () => {
    expect(renderMarkdownToHtml("1行目\n2行目\n\n次の段落")).toBe(
      "<p>1行目 2行目</p>\n<p>次の段落</p>",
    );
  });

  it("太字・斜体・インラインコードを変換する", () => {
    expect(renderMarkdownToHtml("これは**太字**です")).toBe(
      "<p>これは<strong>太字</strong>です</p>",
    );
    expect(renderMarkdownToHtml("これは*斜体*です")).toBe("<p>これは<em>斜体</em>です</p>");
    expect(renderMarkdownToHtml("これは`code`です")).toBe("<p>これは<code>code</code>です</p>");
  });

  it("箇条書き・番号付き箇条書きを変換する", () => {
    expect(renderMarkdownToHtml("- 項目1\n- 項目2")).toBe("<ul><li>項目1</li><li>項目2</li></ul>");
    expect(renderMarkdownToHtml("1. 項目1\n2. 項目2")).toBe(
      "<ol><li>項目1</li><li>項目2</li></ol>",
    );
  });

  it("安全なリンク（https:// または /）はそのまま a タグにする", () => {
    expect(renderMarkdownToHtml("[決算書](/closing)を見る")).toBe(
      '<p><a href="/closing">決算書</a>を見る</p>',
    );
    expect(renderMarkdownToHtml("[外部](https://example.com)")).toBe(
      '<p><a href="https://example.com">外部</a></p>',
    );
  });

  it("危険なスキームのリンクはテキストのみ残しタグ化しない", () => {
    expect(renderMarkdownToHtml("[クリック](javascript:alert(1))")).not.toContain("<a");
    expect(renderMarkdownToHtml("[クリック](data:text/html,x)")).toBe("<p>クリック</p>");
  });

  it("生 HTML はエスケープされ実行可能なタグとして残らない", () => {
    const html = renderMarkdownToHtml("<script>alert(1)</script>と<b>タグ</b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("属性注入を試みる入力もエスケープされる", () => {
    const html = renderMarkdownToHtml('"><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
