import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseFrontmatter, renderMarkdownToHtml } from "@/lib/markdown";

const CONTENT_DIR = path.join(process.cwd(), "src", "content", "learning");

export type LearningTopicSummary = {
  key: string;
  title: string;
  order: number;
  relatedPath: string | null;
  relatedLabel: string | null;
};
export type LearningTopic = LearningTopicSummary & { html: string };

// ビルド時（モジュール初期化時）に確定するトピックキーの一覧。
// `GET /api/learning/topics/[key]` の z.enum ホワイトリストに用い、
// リクエスト値からファイルパスを組み立てることは一切しない。
export const TOPIC_KEYS = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""))
  .sort() as [string, ...string[]];

function readTopicFile(key: string) {
  const raw = readFileSync(path.join(CONTENT_DIR, `${key}.md`), "utf-8");
  return parseFrontmatter(raw);
}

function toSummary(
  key: string,
  frontmatter: ReturnType<typeof parseFrontmatter>["frontmatter"],
): LearningTopicSummary {
  return {
    key,
    title: frontmatter.title,
    order: frontmatter.order ? Number(frontmatter.order) : 0,
    relatedPath: frontmatter.relatedPath ?? null,
    relatedLabel: frontmatter.relatedLabel ?? null,
  };
}

export function loadTopicSummaries(): LearningTopicSummary[] {
  return TOPIC_KEYS.map((key) => toSummary(key, readTopicFile(key).frontmatter)).sort(
    (a, b) => a.order - b.order,
  );
}

// key は呼び出し側で TOPIC_KEYS（z.enum）による検証を済ませている前提。
// 未知の key を渡された場合も、TOPIC_KEYS に無ければ null を返しファイル読み込みをしない。
export function loadTopic(key: string): LearningTopic | null {
  if (!TOPIC_KEYS.includes(key)) return null;
  const { frontmatter, body } = readTopicFile(key);
  return { ...toSummary(key, frontmatter), html: renderMarkdownToHtml(body) };
}
