// 応答を返したあとに続ける処理（レシートの読み取りなど）。Next.js の after() に渡し、
// リクエストの外（結合テスト・スクリプト）で呼ばれたときは、そのまま進める。
// 失敗はログに残すだけ（処理の側で、失敗したことを DB に書いておく）。
import { after } from "next/server";

const pending = new Set<Promise<void>>();

export function runInBackground(name: string, task: () => Promise<void>): void {
  const p: Promise<void> = task()
    .catch((e) => console.error(`[background] ${name} failed:`, e))
    .finally(() => pending.delete(p));
  pending.add(p);
  try {
    after(() => p);
  } catch {
    // リクエストの外では after() を使えない。処理はすでに始まっているので、そのまま進む
  }
}

/** 走っている処理がすべて終わるのを待つ（結合テストで、読み取りの結果を確かめるときに使う） */
export async function settleBackground(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
