// F-9: 学習ガイド用の最小限の Markdown → HTML 変換。
//
// コンテンツは現状リポジトリ管理の静的ファイルのみだが、将来のユーザー投稿化に
// 備えて最初からサニタイズ前提で実装する。方針:
//   1. 生テキストを最初に HTML エスケープしてから構文解析する（生 HTML の混入を
//      構造的に排除する。エスケープ後の文字列にしか変換規則を適用しない）
//   2. リンクは http(s):// または相対パス（/ 始まり）のみ許可し、それ以外は
//      プレーンテキストとして描画する（`javascript:` 等のスキームを排除）
//   3. サポートする構文は見出し(#〜####)・太字・斜体・インラインコード・
//      リンク・箇条書き（-）・番号付き箇条書き（数字.）・段落のみに限定する
//      （フル機能の Markdown パーサーではない）

export type LearningFrontmatter = {
  title: string;
  order?: string;
  relatedPath?: string;
  relatedLabel?: string;
};

export function parseFrontmatter(raw: string): { frontmatter: LearningFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: { title: "" }, body: raw };
  }
  const [, fmBlock, body] = match;
  const fields: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return {
    frontmatter: {
      title: fields.title ?? "",
      order: fields.order,
      relatedPath: fields.relatedPath,
      relatedLabel: fields.relatedLabel,
    },
    body: body.trimStart(),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("/");
}

// 呼び出し順が重要: リンク → 太字 → コード → 斜体（斜体を先にすると **太字** の
// `*` を誤って斜体開始とみなしてしまう）
function renderInline(escaped: string): string {
  let out = escaped;
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text: string, url: string) =>
    isSafeUrl(url) ? `<a href="${url}">${text}</a>` : text,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = escapeHtml(markdown).split("\n");
  const htmlParts: string[] = [];
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length > 0) {
      htmlParts.push(`<p>${renderInline(paragraphBuf.join(" "))}</p>`);
      paragraphBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      htmlParts.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^-\s+/, ""))}</li>`);
        i++;
      }
      htmlParts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      htmlParts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    paragraphBuf.push(line.trim());
    i++;
  }
  flushParagraph();
  return htmlParts.join("\n");
}
