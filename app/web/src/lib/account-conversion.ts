import type { Account, AccountMappingMatchType, AccountMappingRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ConversionMatchType = "TABLE" | "KEYWORD" | "FUZZY" | "AI_FREE" | "MANUAL";

export type ConversionBadge = "auto" | "review" | "manual" | "unconvertible";

export type ConversionSuggestion = {
  homeAccountId: number;
  homeCode: string;
  homeName: string;
  corporateAccountId: number | null;
  corporateCode: string | null;
  corporateName: string | null;
  matchType: ConversionMatchType;
  confidenceScore: number | null;
  isConvertible: boolean;
  isManuallyOverridden: boolean;
  notes: string | null;
};

// 家庭モード科目コードの命名規則（H-prefix）。詳細は docs/home-mode-accounts.md 参照。
export function isHomeAccountCode(code: string): boolean {
  return /^H-/.test(code);
}

// キーワード → 法人科目コード（信頼度 0.9 の高信頼キーワードルール）
// 参照: docs/account-conversion-system.md 「2. 自動変換の判定ロジック」
const KEYWORD_RULES: { keyword: string; corporateCode: string }[] = [
  { keyword: "税", corporateCode: "8200" }, // 租税公課
  { keyword: "保険", corporateCode: "8100" }, // 損害保険料
  { keyword: "通信", corporateCode: "7000" }, // 通信費
  { keyword: "ネット回線", corporateCode: "7000" },
  { keyword: "家賃", corporateCode: "7500" }, // 地代家賃
  { keyword: "管理費", corporateCode: "7500" },
  { keyword: "駐車場", corporateCode: "7500" },
  { keyword: "交通", corporateCode: "7300" }, // 車両費
  { keyword: "ガソリン", corporateCode: "7300" },
  { keyword: "高速道路", corporateCode: "7300" },
  { keyword: "車検", corporateCode: "7300" },
  { keyword: "広告", corporateCode: "7900" }, // 広告宣伝費
  { keyword: "宣伝", corporateCode: "7900" },
  { keyword: "交際", corporateCode: "8000" }, // 接待交際費
  { keyword: "贈答", corporateCode: "8000" },
  { keyword: "冠婚葬祭", corporateCode: "8000" },
  { keyword: "会議", corporateCode: "7400" }, // 会議費
  { keyword: "福利厚生", corporateCode: "7800" },
  { keyword: "給与", corporateCode: "7700" }, // 給与賃金
  { keyword: "賞与", corporateCode: "7700" },
  { keyword: "水道", corporateCode: "7200" }, // 水道光熱費
  { keyword: "光熱", corporateCode: "7200" },
  { keyword: "電気", corporateCode: "7200" },
  { keyword: "ガス代", corporateCode: "7200" },
  { keyword: "消耗品", corporateCode: "7100" },
  { keyword: "日用品", corporateCode: "7100" },
];

// カテゴリ別フォールバック（無料 AI 推論ステップの代替: ルールベースの粗いカテゴリ一致）
const CATEGORY_FALLBACK_CODE: Partial<Record<Account["category"], string>> = {
  REVENUE: "4000", // 売上高
  COGS: "5000", // 仕入高
  EXPENSE: "8300", // 雑費
};

function normalize(name: string): string {
  return name.replace(/[・／/\s()（）]/g, "");
}

// 2 文字 bigram の Dice 係数によるあいまい一致（0〜1）
function similarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const arr: string[] = [];
    for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    return arr;
  };
  const A = bigrams(normalize(a));
  const B = bigrams(normalize(b));
  if (A.length === 0 || B.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const bg of B) remaining.set(bg, (remaining.get(bg) ?? 0) + 1);
  let common = 0;
  for (const bg of A) {
    const c = remaining.get(bg) ?? 0;
    if (c > 0) {
      common++;
      remaining.set(bg, c - 1);
    }
  }
  return (2 * common) / (A.length + B.length);
}

const FUZZY_THRESHOLD = 0.5;

// homeCode ごとに、ユーザー独自ルールをシステム定義ルール（userId=null）より優先する
function pickRule(
  rules: AccountMappingRule[],
  homeCode: string,
  userId: number,
): AccountMappingRule | null {
  let system: AccountMappingRule | null = null;
  let own: AccountMappingRule | null = null;
  for (const r of rules) {
    if (r.homeCode !== homeCode) continue;
    if (r.userId === userId) own = r;
    else if (r.userId === null) system = r;
  }
  return own ?? system;
}

export async function suggestConversions(
  userId: number,
  homeAccounts: Account[],
  corporateAccounts: Account[],
): Promise<ConversionSuggestion[]> {
  if (homeAccounts.length === 0) return [];

  const homeCodes = homeAccounts.map((a) => a.code);
  const rules = await prisma.accountMappingRule.findMany({
    where: { homeCode: { in: homeCodes }, OR: [{ userId }, { userId: null }] },
  });
  const byCorpCode = new Map(corporateAccounts.map((a) => [a.code, a]));

  return homeAccounts.map((home): ConversionSuggestion => {
    const rule = pickRule(rules, home.code, userId);
    if (rule) {
      const corp = rule.corporateCode ? (byCorpCode.get(rule.corporateCode) ?? null) : null;
      return {
        homeAccountId: home.id,
        homeCode: home.code,
        homeName: home.name,
        corporateAccountId: corp?.id ?? null,
        corporateCode: rule.corporateCode,
        corporateName: corp?.name ?? null,
        matchType: rule.userId ? "MANUAL" : "TABLE",
        confidenceScore: rule.confidenceScore,
        isConvertible: rule.isConvertible,
        isManuallyOverridden: rule.userId !== null,
        notes: rule.notes,
      };
    }

    const kw = KEYWORD_RULES.find((k) => home.name.includes(k.keyword));
    if (kw) {
      const corp = byCorpCode.get(kw.corporateCode);
      if (corp) {
        return {
          homeAccountId: home.id,
          homeCode: home.code,
          homeName: home.name,
          corporateAccountId: corp.id,
          corporateCode: corp.code,
          corporateName: corp.name,
          matchType: "KEYWORD",
          confidenceScore: 0.9,
          isConvertible: true,
          isManuallyOverridden: false,
          notes: null,
        };
      }
    }

    let best: { acc: Account; score: number } | null = null;
    for (const corp of corporateAccounts) {
      const score = similarity(home.name, corp.name);
      if (!best || score > best.score) best = { acc: corp, score };
    }
    if (best && best.score >= FUZZY_THRESHOLD) {
      return {
        homeAccountId: home.id,
        homeCode: home.code,
        homeName: home.name,
        corporateAccountId: best.acc.id,
        corporateCode: best.acc.code,
        corporateName: best.acc.name,
        matchType: "FUZZY",
        confidenceScore: Math.round(best.score * 100) / 100,
        isConvertible: true,
        isManuallyOverridden: false,
        notes: null,
      };
    }

    // AI 推論ステップの代替: ルールベースの疑似 AI（カテゴリ別フォールバック）
    const fallbackCode = CATEGORY_FALLBACK_CODE[home.category];
    const fallback = fallbackCode ? byCorpCode.get(fallbackCode) : undefined;
    if (fallback) {
      return {
        homeAccountId: home.id,
        homeCode: home.code,
        homeName: home.name,
        corporateAccountId: fallback.id,
        corporateCode: fallback.code,
        corporateName: fallback.name,
        matchType: "AI_FREE",
        confidenceScore: 0.4,
        isConvertible: true,
        isManuallyOverridden: false,
        notes: "カテゴリに基づく暫定候補です。内容をご確認のうえ変更してください。",
      };
    }

    return {
      homeAccountId: home.id,
      homeCode: home.code,
      homeName: home.name,
      corporateAccountId: null,
      corporateCode: null,
      corporateName: null,
      matchType: "MANUAL",
      confidenceScore: null,
      isConvertible: false,
      isManuallyOverridden: false,
      notes: "自動候補が見つかりませんでした。手動でマッピングしてください。",
    };
  });
}

export type SessionLogDetail = {
  id: number;
  matchType: AccountMappingMatchType;
  confidenceScore: number | null;
  isConvertible: boolean;
  isManuallyOverridden: boolean;
  homeAccount: { code: string; name: string } | null;
  corporateAccount: { code: string; name: string } | null;
};

export type SessionDetail = {
  id: number;
  fromMode: string;
  toMode: string;
  convertedAt: Date;
  status: string;
  logs: SessionLogDetail[];
};

// 変換セッションの詳細（科目名を結合済み）を取得する。所有者でなければ null を返す。
export async function getSessionDetail(
  sessionId: number,
  tenantId: number,
  userId: number,
): Promise<SessionDetail | null> {
  const session = await prisma.accountConversionSession.findUnique({
    where: { id: sessionId },
    include: { logs: true },
  });
  if (!session || session.userId !== userId) return null;

  const accountIds = [
    ...new Set(
      session.logs
        .flatMap((l) => [l.homeAccountId, l.corporateAccountId])
        .filter((x): x is number => x != null),
    ),
  ];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, tenantId } });
  const byId = new Map(accounts.map((a) => [a.id, { code: a.code, name: a.name }]));

  return {
    id: session.id,
    fromMode: session.fromMode,
    toMode: session.toMode,
    convertedAt: session.convertedAt,
    status: session.status,
    logs: session.logs.map((l) => ({
      id: l.id,
      matchType: l.matchType,
      confidenceScore: l.confidenceScore,
      isConvertible: l.isConvertible,
      isManuallyOverridden: l.isManuallyOverridden,
      homeAccount: byId.get(l.homeAccountId) ?? null,
      corporateAccount:
        l.corporateAccountId != null ? (byId.get(l.corporateAccountId) ?? null) : null,
    })),
  };
}

export function badgeFor(
  s: Pick<ConversionSuggestion, "isConvertible" | "confidenceScore" | "corporateAccountId">,
): ConversionBadge {
  if (!s.isConvertible) return "unconvertible";
  if (s.corporateAccountId === null) return "manual";
  const score = s.confidenceScore ?? 0;
  if (score >= 0.8) return "auto";
  if (score >= 0.5) return "review";
  return "manual";
}
