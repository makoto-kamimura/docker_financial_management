import Constants from "expo-constants";

const _devHost = Constants.expoConfig?.hostUri?.split(":")[0] ?? "localhost";
const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `http://${_devHost}:3000/api`;

const TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ── セッション・モード管理 ─────────────────────────────────────────────
let _session = "";
let _viewMode: ViewMode = "sole";

export function getSession() { return _session; }
export function setSession(token: string) { _session = token; }
export function clearSession() { _session = ""; }
export function getViewMode() { return _viewMode; }
export function setViewMode(m: ViewMode) { _viewMode = m; }

export type ViewMode = "household" | "sole" | "corporate";
export const VIEW_MODES: { value: ViewMode; label: string; short: string }[] = [
  { value: "household", label: "家計簿",   short: "家計" },
  { value: "sole",      label: "個人会計", short: "個人" },
  { value: "corporate", label: "法人",     short: "法人" },
];

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (_session) headers["Authorization"] = `Bearer ${_session}`;
  return fetchWithTimeout(`${API_BASE_URL}${path}`, { ...init, headers });
}

// ── Auth ──────────────────────────────────────────────────────────────
export type UserInfo = { id: number; name: string; role: string };

export async function login(email: string, password: string): Promise<UserInfo> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError"
      ? `サーバーに接続できません（${API_BASE_URL}）\nDockerが起動しているか確認してください。`
      : `ネットワークエラー: ${e instanceof Error ? e.message : String(e)}`;
    throw new Error(msg);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "ログインに失敗しました");
  setSession(json.data.sessionId as string);
  return { id: json.data.id, name: json.data.name, role: json.data.role };
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  clearSession();
}

// ── 共通型 ────────────────────────────────────────────────────────────
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

// ── KPI ───────────────────────────────────────────────────────────────
export type KpiData = {
  period: string;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  operatingProfit: number;
  operatingMargin: number;
  mom: number | null;
  yoy: number | null;
  ytd: number;
};

export async function fetchKpi(): Promise<KpiData | null> {
  const res = await apiFetch("/kpi");
  if (!res.ok) throw new Error("KPI の取得に失敗しました");
  const json = await res.json();
  return json.kpi ?? null;
}

// ── 予測 ──────────────────────────────────────────────────────────────
export type ForecastResponse = {
  accountCode: string;
  method: string;
  scenario: string;
  history: { key: string; total: number }[];
  forecast: number[];
};

export async function fetchForecast(accountCode = "H1000", months = 6): Promise<ForecastResponse> {
  const res = await apiFetch(`/forecasts?accountCode=${accountCode}&months=${months}`);
  if (!res.ok) throw new Error("予測データの取得に失敗しました");
  return res.json();
}

export type BudgetActualRow = {
  period: string;
  budget: number;
  actual: number | null;
  forecast: number | null;
};

export async function fetchBudgetActual(
  accountCode = "H1000",
  year = new Date().getFullYear(),
  method = "moving_average",
): Promise<{ rows: BudgetActualRow[] }> {
  const res = await apiFetch(
    `/reports/budget-actual?accountCode=${accountCode}&year=${year}&method=${method}`,
  );
  if (!res.ok) throw new Error("予実データの取得に失敗しました");
  return res.json();
}

// ── 実績 ──────────────────────────────────────────────────────────────
export async function fetchAccounts(): Promise<Account[]> {
  const res = await apiFetch("/accounts");
  if (!res.ok) throw new Error("勘定科目の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchRecentHistory(limit = 30): Promise<RecentHistory[]> {
  const res = await apiFetch(`/financials/recent?limit=${limit}`);
  if (!res.ok) throw new Error("履歴の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

export async function postFinancialRecord(data: {
  accountCode: string; fiscalYear: number; month: number; amount: number;
}): Promise<void> {
  const res = await apiFetch("/financials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? "登録に失敗しました");
  }
}

// ── 資産 ──────────────────────────────────────────────────────────────
export type AssetAccount = {
  id: number; code: string; name: string;
  category: "ASSET" | "LIABILITY";
  parentId: number | null;
  balances: { fiscalYear: number; month: number; amount: number }[];
};

export async function fetchAssets(year?: number): Promise<{ years: number[]; accounts: AssetAccount[] }> {
  const q = year ? `?year=${year}` : "";
  const res = await apiFetch(`/assets${q}`);
  if (!res.ok) throw new Error("資産データの取得に失敗しました");
  return res.json();
}

// ── 予算 ──────────────────────────────────────────────────────────────
export type BudgetRow = {
  id: number;
  accountCode: string;
  accountName: string;
  month: number;
  amount: number;
  account?: { code: string; name: string; category: string };
  period?: { fiscalYear: number; month: number };
};

export type HousingLoanOverlayRow = {
  accountId: number;
  accountCode: string;
  month: number;
  amount: number;
};

export async function fetchBudgets(year: number): Promise<{
  budgets: BudgetRow[];
  housingLoanOverlay: HousingLoanOverlayRow[];
}> {
  const res = await apiFetch(`/budgets?year=${year}`);
  if (!res.ok) throw new Error("予算データの取得に失敗しました");
  const json = await res.json();
  return { budgets: json.data ?? [], housingLoanOverlay: json.housingLoanOverlay ?? [] };
}

export async function postBudget(data: {
  accountCode: string; fiscalYear: number; month: number; amount: number;
}): Promise<void> {
  const res = await apiFetch("/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("予算の保存に失敗しました");
}

// ── 予算配分ルール（FP推奨・手取り収入ベース） ───────────────────────
export type AllocationGroup = "固定費" | "生活費" | "その他";

export type AllocationItem = {
  key: string;
  label: string;
  group: AllocationGroup;
  minPercent: number;
  /** null = 上限なし（「○％以上」の目安） */
  maxPercent: number | null;
  note?: string;
};

export const DEFAULT_ALLOCATION: AllocationItem[] = [
  { key: "rent",          label: "家賃・住宅ローン",                    group: "固定費", minPercent: 20, maxPercent: 30, note: "理想は25%以内" },
  { key: "utilities",     label: "水道・光熱費",                        group: "固定費", minPercent: 5,  maxPercent: 8 },
  { key: "communication", label: "通信費（スマホ・インターネット）",     group: "固定費", minPercent: 3,  maxPercent: 6 },
  { key: "insurance",     label: "保険料",                              group: "固定費", minPercent: 5,  maxPercent: 10 },
  { key: "food",          label: "食費",                                group: "生活費", minPercent: 15, maxPercent: 20 },
  { key: "car",           label: "車関連（ガソリン・保険・駐車場など）", group: "生活費", minPercent: 5,  maxPercent: 15 },
  { key: "daily",         label: "日用品・衣服",                        group: "生活費", minPercent: 3,  maxPercent: 5 },
  { key: "education",     label: "教育費（子どもがいる場合）",          group: "生活費", minPercent: 5,  maxPercent: 15 },
  { key: "leisure",       label: "娯楽・交際費",                        group: "その他", minPercent: 5,  maxPercent: 10 },
  { key: "savings",       label: "貯蓄・投資",                          group: "その他", minPercent: 20, maxPercent: null, note: "最低10%は確保" },
];

let _allocation: AllocationItem[] = DEFAULT_ALLOCATION.map(i => ({ ...i }));

export function getAllocation(): AllocationItem[] {
  return _allocation;
}
export function setAllocation(items: AllocationItem[]) {
  _allocation = items;
}
export function resetAllocation(): AllocationItem[] {
  _allocation = DEFAULT_ALLOCATION.map(i => ({ ...i }));
  return _allocation;
}

// ── 銀行口座 ──────────────────────────────────────────────────────────
export type BankAccount = {
  id: number; name: string; bankName: string;
  accountType: string; role: string; balance: number;
};

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await apiFetch("/bank-accounts");
  if (!res.ok) throw new Error("銀行口座の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── 入出金明細 ────────────────────────────────────────────────────────
export type BankTransaction = {
  id: number; date: string; description: string;
  amount: number; balance: number | null;
  accountId: number;
};

export async function fetchBankTransactions(params: {
  accountId: number;
}): Promise<BankTransaction[]> {
  const res = await apiFetch(`/bank-accounts/${params.accountId}/transactions`);
  if (!res.ok) throw new Error("入出金明細の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── 固定の入出金 ──────────────────────────────────────────────────────
export type Transfer = {
  id: number; label: string; channel: string; direction: string;
  day: number; amount: number; note: string | null;
  fromAccountId: number | null; toAccountId: number | null;
};

export async function fetchTransfers(): Promise<Transfer[]> {
  const res = await apiFetch("/transfers");
  if (!res.ok) throw new Error("固定の入出金の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

export type FlowGraph = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

export type TransferFlowResponse = {
  cyclic: boolean;
  graph: FlowGraph;
};

export async function fetchTransferFlow(): Promise<TransferFlowResponse> {
  const res = await apiFetch("/transfers/flow");
  if (!res.ok) throw new Error("フローデータの取得に失敗しました");
  return res.json();
}

// ── 残高シミュレーション ──────────────────────────────────────────────
export type SimResult = {
  ok: boolean;
  shortfallMonth: string | null;
  points: { label: string; balances: Record<number, number>; total: number }[];
};

export async function runSimulation(body: {
  openings: Record<number, number>;
  months: number;
  startYear: number;
  startMonth: number;
}): Promise<SimResult> {
  const res = await apiFetch("/transfers/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("シミュレーションに失敗しました");
  return res.json();
}

// ── キャッシュフロー ──────────────────────────────────────────────────
export type CashFlowTotals = {
  revenue: number; cogs: number; expense: number;
  grossProfit: number; operatingProfit: number;
};

export async function fetchCashFlow(mode: ViewMode, year?: string): Promise<{
  totals: CashFlowTotals;
  labels: Record<string, string>;
}> {
  const q = new URLSearchParams({ mode });
  if (year && year !== "all") q.set("year", year);
  const res = await apiFetch(`/cashflow?${q}`);
  if (!res.ok) throw new Error("キャッシュフローの取得に失敗しました");
  return res.json();
}

// ── 借入金 ────────────────────────────────────────────────────────────
export type Loan = {
  id: number; lenderName: string; amount: string;
  interestRate: string; borrowedOn: string;
  repaymentDate: string; remainingAmount: string;
  status: string; note: string | null;
  loanType: string;
  linkedAccountId: number | null;
  linkedAccount: { id: number; code: string; name: string } | null;
  monthlyPayment: string | null;
};

export async function fetchLoans(): Promise<Loan[]> {
  const res = await apiFetch("/loans");
  if (!res.ok) throw new Error("借入金の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

export async function postLoan(data: {
  lenderName: string; amount: number; interestRate: number;
  borrowedOn: string; repaymentDate: string; note?: string;
  loanType?: "business" | "housing";
  linkedAccountCode?: string;
  monthlyPayment?: number;
}): Promise<Loan> {
  const res = await apiFetch("/loans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("借入金の登録に失敗しました");
  const json = await res.json();
  return json.data;
}

export async function patchLoan(id: number, data: {
  repaymentDate?: string;
  monthlyPayment?: number | null;
  linkedAccountCode?: string | null;
}): Promise<Loan> {
  const res = await apiFetch(`/loans/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("借入金の更新に失敗しました");
  const json = await res.json();
  return json.data;
}

// ── 実物資産（土地・建物・車・金など） ──────────────────────────────
export type PersonalAssetCategory = "LAND" | "BUILDING" | "VEHICLE" | "GOLD" | "OTHER";
export type PersonalAsset = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string | null;
  acquisitionCost: string | null;
  currentValue: string;
  note: string | null;
};

export async function fetchPersonalAssets(): Promise<PersonalAsset[]> {
  const res = await apiFetch("/personal-assets");
  if (!res.ok) throw new Error("資産の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

export async function postPersonalAsset(data: {
  name: string; category: PersonalAssetCategory;
  acquiredOn?: string; acquisitionCost?: number; currentValue: number; note?: string;
}): Promise<PersonalAsset> {
  const res = await apiFetch("/personal-assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("資産の登録に失敗しました");
  const json = await res.json();
  return json.data;
}

export async function patchPersonalAsset(id: number, data: { currentValue: number }): Promise<PersonalAsset> {
  const res = await apiFetch(`/personal-assets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("資産の更新に失敗しました");
  const json = await res.json();
  return json.data;
}

export async function deletePersonalAsset(id: number): Promise<void> {
  const res = await apiFetch(`/personal-assets/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("資産の削除に失敗しました");
}

// ── 仕訳帳 ────────────────────────────────────────────────────────────
export type JournalEntry = {
  id: number; transactionDate: string; description: string;
  paymentMethod: string; taxCategory: string; approvalStatus: string;
  details: { side: string; amount: number; account: { code: string; name: string } }[];
};

export async function fetchJournals(limit = 30): Promise<JournalEntry[]> {
  const res = await apiFetch(`/journals?limit=${limit}`);
  if (!res.ok) throw new Error("仕訳帳の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── インボイス ────────────────────────────────────────────────────────
export type Invoice = {
  id: number; invoiceNumber: string; customerName: string;
  issueDate: string; dueDate: string; status: string;
  total: string;
};

export async function fetchInvoices(): Promise<Invoice[]> {
  const res = await apiFetch("/invoices");
  if (!res.ok) throw new Error("インボイスの取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}

// ── 決算 ──────────────────────────────────────────────────────────────
export type ClosingData = {
  fiscalYear: number;
  pnl: {
    revenueTotal: number; cogsTotal: number;
    grossProfit: number; expenseTotal: number; netIncome: number;
  };
  bs: { assetTotal: number; liabilityTotal: number; equity: number };
  ratios: {
    grossProfitRate: number | null; operatingMargin: number | null;
    currentRatio: number | null; equityRatio: number | null;
  };
};

export async function fetchClosing(year: number): Promise<ClosingData> {
  const res = await apiFetch(`/closing/statements?year=${year}`);
  if (!res.ok) throw new Error("決算データの取得に失敗しました");
  return res.json();
}

// ── 役員（ガバナンス） ────────────────────────────────────────────────
export type Officer = {
  id: number; name: string; title: string;
  termStart: string; termEnd: string; salary: string | null;
};

export async function fetchOfficers(): Promise<Officer[]> {
  const res = await apiFetch("/officers");
  if (!res.ok) throw new Error("役員情報の取得に失敗しました");
  const json = await res.json();
  return json.data ?? [];
}
