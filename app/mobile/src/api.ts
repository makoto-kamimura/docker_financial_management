import Constants from "expo-constants";

const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ??
  "http://localhost:3000/api";

// ── セッション管理（モジュール変数 - アプリ再起動でリセット）──────────
let _session = "";
export function getSession() { return _session; }
export function setSession(token: string) { _session = token; }
export function clearSession() { _session = ""; }

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (_session) headers["Cookie"] = `fm_session=${_session}`;
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

// ── Auth ──────────────────────────────────────────────────────────────

export type UserInfo = { id: number; name: string; role: string };

export async function login(email: string, password: string): Promise<UserInfo> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "ログインに失敗しました");
  setSession(json.data.sessionId as string);
  return { id: json.data.id, name: json.data.name, role: json.data.role };
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  clearSession();
}

// ── Types ─────────────────────────────────────────────────────────────

export type ForecastResponse = {
  accountCode: string;
  method: string;
  scenario: string;
  history: { key: string; total: number }[];
  forecast: number[];
};

export type KpiData = {
  latestKey: string;
  revenue: number;
  cogs: number;
  expense: number;
  profit: number;
  profitMargin: number;
  yoyRevenue: number | null;
  momRevenue: number | null;
  ytdRevenue: number;
};

export type AssetAccount = {
  id: number;
  code: string;
  name: string;
  category: "ASSET" | "LIABILITY";
  parentId: number | null;
  balances: { fiscalYear: number; month: number; amount: number }[];
};

export type BudgetRow = {
  id: number;
  accountCode: string;
  accountName: string;
  month: number;
  amount: number;
  account?: { code: string; name: string; category: string };
  period?: { fiscalYear: number; month: number };
};

export type Account = { id: number; code: string; name: string; category: string };

export type RecentHistory = {
  historyId: number;
  recordId: number;
  action: string;
  amount: number;
  changedAt: string;
  account: { code: string; name: string; category: string };
  period: { fiscalYear: number; month: number };
};

// ── Forecast ──────────────────────────────────────────────────────────

export async function fetchForecast(
  accountCode = "H1000",
  months = 6,
): Promise<ForecastResponse> {
  const res = await apiFetch(`/forecasts?accountCode=${accountCode}&months=${months}`);
  if (!res.ok) throw new Error("予測データの取得に失敗しました");
  return res.json();
}

// ── KPI ───────────────────────────────────────────────────────────────

export async function fetchKpi(): Promise<KpiData> {
  const res = await apiFetch("/kpi");
  if (!res.ok) throw new Error("KPI の取得に失敗しました");
  const json = await res.json();
  // API の Kpi 型 → モバイルの KpiData 型へマッピング
  // grossMargin / yoy / mom は比率（0-1）なのでパーセントに変換
  const k = json.kpi ?? {};
  return {
    latestKey: k.period ?? "",
    revenue: k.revenue ?? 0,
    cogs: 0,
    expense: 0,
    profit: k.grossProfit ?? 0,
    profitMargin: (k.grossMargin ?? 0) * 100,
    yoyRevenue: k.yoy != null ? k.yoy * 100 : null,
    momRevenue: k.mom != null ? k.mom * 100 : null,
    ytdRevenue: k.ytd ?? 0,
  };
}

// ── Assets ────────────────────────────────────────────────────────────

export async function fetchAssets(year?: number): Promise<{ years: number[]; accounts: AssetAccount[] }> {
  const q = year ? `?year=${year}` : "";
  const res = await apiFetch(`/assets${q}`);
  if (!res.ok) throw new Error("資産データの取得に失敗しました");
  return res.json();
}

// ── Budgets ───────────────────────────────────────────────────────────

export async function fetchBudgets(year: number): Promise<BudgetRow[]> {
  const res = await apiFetch(`/budgets?year=${year}`);
  if (!res.ok) throw new Error("予算データの取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── Accounts ──────────────────────────────────────────────────────────

export async function fetchAccounts(): Promise<Account[]> {
  const res = await apiFetch("/accounts");
  if (!res.ok) throw new Error("勘定科目の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── Recent History ────────────────────────────────────────────────────

export async function fetchRecentHistory(limit = 20): Promise<RecentHistory[]> {
  const res = await apiFetch(`/financials/recent?limit=${limit}`);
  if (!res.ok) throw new Error("履歴の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── Financial Record (手入力) ──────────────────────────────────────────

export async function postFinancialRecord(data: {
  accountCode: string;
  fiscalYear: number;
  month: number;
  amount: number;
}): Promise<void> {
  const res = await apiFetch("/financials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "登録に失敗しました");
  }
}
