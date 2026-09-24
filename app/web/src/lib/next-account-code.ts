// 勘定科目コードの自動採番。
// コード体系はモード・テナントで異なる（例: 家庭 "H-3001" / 法人 "C7000" / 個人 "7000"）ため、
// 固定の規則を押し付けず「同じ区分で最も多く使われている接頭辞の続き番号」を採る。

import type { AccountCategoryValue } from "@/lib/account-category";

// 同じ区分に既存コードが 1 件も無い場合の既定（家庭モードの科目マスタに合わせる）
const DEFAULT_PREFIX: Record<string, string> = {
  REVENUE: "H-1",
  COGS: "H-2",
  EXPENSE: "H-3",
  LIABILITY: "H-4",
  ASSET: "H-5",
  PROFIT: "H-6",
  OTHER: "H-9",
};
const DEFAULT_WIDTH = 3; // "H-1" + "001" = "H-1001"

type Parsed = { prefix: string; value: number; width: number };

// "H-3001" → { prefix: "H-", value: 3001, width: 4 }。数字で終わらないコードは対象外。
function parse(code: string): Parsed | null {
  const m = code.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], value: Number(m[2]), width: m[2].length };
}

/**
 * 同じ区分の既存コードから次のコードを決める。
 * @param existingCodes その区分の既存コード（他区分を混ぜない）
 * @param allCodes テナント内の全コード（重複回避に使う）
 */
export function nextAccountCode(
  existingCodes: string[],
  category: AccountCategoryValue | string,
  allCodes: string[] = existingCodes,
): string {
  const parsed = existingCodes.map(parse).filter((p): p is Parsed => p !== null);

  let prefix: string;
  let width: number;
  let max = 0;

  if (parsed.length === 0) {
    prefix = DEFAULT_PREFIX[category] ?? "H-9";
    width = DEFAULT_WIDTH;
  } else {
    // 最も多く使われている接頭辞を採用（同数なら文字列順で先のもの＝結果を安定させる）
    const counts = new Map<string, number>();
    for (const p of parsed) counts.set(p.prefix, (counts.get(p.prefix) ?? 0) + 1);
    prefix = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const samePrefix = parsed.filter((p) => p.prefix === prefix);
    width = Math.max(...samePrefix.map((p) => p.width));
    max = Math.max(...samePrefix.map((p) => p.value));
  }

  const used = new Set(allCodes);
  let next = max + 1;
  // 既に使われているコードは飛ばす（他区分が同じ連番を使っている場合の保険）
  for (let i = 0; i < 10000; i++) {
    const candidate = `${prefix}${String(next).padStart(width, "0")}`;
    if (!used.has(candidate)) return candidate;
    next++;
  }
  // ここに来るのは 1 万件連続で埋まっている異常時のみ
  return `${prefix}${Date.now()}`;
}
