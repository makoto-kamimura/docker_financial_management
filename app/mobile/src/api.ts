import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import type { ViewMode } from "./shared/display-name";
import type { PersonalAssetCategory } from "./shared/labels";
import type { Loan } from "./shared/loan-schedule";

const _devHost = Constants.expoConfig?.hostUri?.split(":")[0] ?? "localhost";
const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? `http://${_devHost}:3000/api`;

const TIMEOUT_MS = 10_000;

// ネイティブアプリであることをサーバへ明示するヘッダ（web/src/lib/csrf.ts と対の値）。
// ブラウザはクロスサイトのリクエストにカスタムヘッダを付けられない（プリフライトが必要で、
// 本 API は CORS を許可していない）ため、このヘッダがあれば CSRF ではないと判断できる。
const CLIENT_HEADER = "X-Requested-With";
const CLIENT_HEADER_VALUE = "fm-mobile";

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  // credentials: "omit" は必須。React Native は Cookie ストア（iOS: NSHTTPCookieStorage /
  // Android: okhttp CookieJar）を既定で有効にしているため、ログイン成功時にサーバが返す
  // セッション Cookie が保存され、以降の全リクエストに自動付与されてしまう。
  // 本アプリの認証は Bearer トークンのみで Cookie は不要な一方、Cookie が付くと
  // サーバの CSRF 検査（Origin/Sec-Fetch を送らないクライアントで Cookie だけがある場合は
  // フェイルクローズ）に該当し、2 回目以降のログインが 403 forbidden: invalid origin になる。
  return fetch(url, {
    ...init,
    credentials: "omit",
    headers: {
      ...((init?.headers as Record<string, string>) ?? {}),
      [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
    },
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
}

// ── セッション・モード管理 ─────────────────────────────────────────────
// S-14: セッショントークンは端末の Keychain / Keystore（expo-secure-store）に永続化する。
// AsyncStorage は平文保存でありトークンの保管先として使わない。
const SESSION_STORE_KEY = "fm_session_token";

let _session = "";
// F-11: ステップ導線と整合させ、初期値は household とする（メモリ内保持のため常に起動時の既定値）
let _viewMode: ViewMode = "household";

export function getSession() {
  return _session;
}

// メモリ上のセッションを更新し、SecureStore への永続化を行う（await 可能）。
export async function setSession(token: string) {
  _session = token;
  await SecureStore.setItemAsync(SESSION_STORE_KEY, token).catch((e) => {
    console.warn("[secure-store] failed to persist session:", e);
  });
}

export async function clearSession() {
  _session = "";
  await SecureStore.deleteItemAsync(SESSION_STORE_KEY).catch(() => {});
}

// アプリ起動時に呼び出す。SecureStore に保存済みのトークンがあれば読み込み、
// GET /api/auth/me で有効性を確認したうえでユーザー情報を返す。
// - トークンが無効（401 等）: SecureStore からも削除し null を返す
// - ネットワークエラー: トークンは保持したまま（次回起動時に再試行できるように）null を返す
export async function restoreSession(): Promise<UserInfo | null> {
  const token = await SecureStore.getItemAsync(SESSION_STORE_KEY).catch(() => null);
  if (!token) return null;
  _session = token;

  try {
    const res = await apiFetch("/auth/me");
    if (!res.ok) {
      await clearSession();
      return null;
    }
    const json = await res.json();
    if (!json.user) {
      await clearSession();
      return null;
    }
    return { id: json.user.id, name: json.user.name, role: json.user.role };
  } catch {
    _session = "";
    return null;
  }
}

export function getViewMode() {
  return _viewMode;
}
export function setViewMode(m: ViewMode) {
  // F-10: ステップ進捗チェックリストの「モード切替経験」判定に使う（web の localStorage 相当）
  if (_viewMode !== m) _viewModeSwitched = true;
  _viewMode = m;
}

let _viewModeSwitched = false;
export function hasSwitchedViewMode() {
  return _viewModeSwitched;
}

// 表示モードの型は web と共有する（shared/display-name.ts）
export type { ViewMode };
export { VIEW_MODES } from "./shared/mode-labels";

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (_session) headers["Authorization"] = `Bearer ${_session}`;
  return fetchWithTimeout(`${API_BASE_URL}${path}`, { ...init, headers });
}

// JSON を送るリクエストの init（POST / PATCH / PUT）
function jsonInit(method: "POST" | "PATCH" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// API のエラー本文（{ error: string } もしくは Zod の flatten）から表示用の文言を取り出す
function errorMessage(json: unknown, fallback: string): string {
  const err = (json as { error?: unknown } | null)?.error;
  return typeof err === "string" && err ? err : fallback;
}

// レスポンス本文を JSON で返す。失敗時はサーバーのエラー文言（無ければ fallback）で例外にする。
async function request<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(json, fallback));
  return json as T;
}

// ── Auth ──────────────────────────────────────────────────────────────
export type UserInfo = { id: number; name: string; role: string };

// S-15: MFA 有効ユーザーは 1 段階目（パスワード）成功時にセッションを発行せず
// { mfaRequired: true, mfaToken } を返す。呼び出し側は status で分岐する。
export type LoginResult =
  | { status: "success"; user: UserInfo }
  | { status: "mfaRequired"; mfaToken: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? `サーバーに接続できません（${API_BASE_URL}）\nDockerが起動しているか確認してください。`
        : `ネットワークエラー: ${e instanceof Error ? e.message : String(e)}`;
    throw new Error(msg);
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok) {
    await setSession(json.data.sessionId as string);
    return {
      status: "success",
      user: { id: json.data.id, name: json.data.name, role: json.data.role },
    };
  }
  if (res.status === 401 && json.mfaRequired && json.mfaToken) {
    return { status: "mfaRequired", mfaToken: json.mfaToken as string };
  }
  throw new Error(json.error ?? "ログインに失敗しました");
}

// ログイン第 2 段階。TOTP コードまたはリカバリーコードで認証を完了しセッションを発行する。
export async function verifyMfa(
  mfaToken: string,
  input: { code?: string; recoveryCode?: string },
): Promise<UserInfo> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE_URL}/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, ...input }),
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? `サーバーに接続できません（${API_BASE_URL}）\nDockerが起動しているか確認してください。`
        : `ネットワークエラー: ${e instanceof Error ? e.message : String(e)}`;
    throw new Error(msg);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "認証コードの確認に失敗しました");
  await setSession(json.data.sessionId as string);
  return { id: json.data.id, name: json.data.name, role: json.data.role };
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  await clearSession();
}

// ── 共通型 ────────────────────────────────────────────────────────────
export type Account = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
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

// 対象月の予算（web 版 KPI カードの「予算 ◯円（達成率 ◯%）」行と同じ内容）
export type KpiBudget = {
  revenue: number;
  cogs: number;
  expense: number;
  grossProfit: number;
  operatingProfit: number;
  revenueRate: number | null;
  expenseRate: number | null;
  operatingProfitRate: number | null;
};

// 当年の着地見込み（残り月は移動平均で予測）と、その時点の達成率
export type AnnualOutlook = {
  year: number;
  ytd: number;
  remainingMonths: number;
  forecastRemaining: number;
  projected: number;
  progressRate: number | null;
};

export type KpiResponse = {
  kpi: KpiData | null;
  budget: KpiBudget | null;
  /** 実績のある月（昇順）。対象月セレクタの候補に使う */
  periods: string[];
  annual: AnnualOutlook | null;
};

// period 省略時はサーバー既定（現在月以前で最も新しい実績月）
export async function fetchKpi(period?: string): Promise<KpiResponse> {
  const json = await request<Partial<KpiResponse>>(
    period ? `/kpi?period=${period}` : "/kpi",
    "KPI の取得に失敗しました",
  );
  return {
    kpi: json.kpi ?? null,
    budget: json.budget ?? null,
    periods: json.periods ?? [],
    annual: json.annual ?? null,
  };
}

// ── 推移（構成比グラフ）─────────────────────────────────────────────────
// web 版ダッシュボードと同じ /reports/monthly-trend を使う。
// 対象月以前は実績、実績が未入力の将来月は予測値（isForecast=true）。
export type TrendMonth = {
  key: string; // "YYYY-MM"
  isForecast: boolean;
  REVENUE: number;
  COGS: number;
  EXPENSE: number;
  PROFIT: number;
  OTHER: number;
  savings: number | null;
  savingsForecast: number | null;
};

export type TrendResponse = {
  period: string;
  year: number | null;
  months: TrendMonth[];
  years: number[];
};

export async function fetchMonthlyTrend(params: {
  period?: string;
  year?: number;
  back?: number;
  forward?: number;
  method?: string;
}): Promise<TrendResponse> {
  const q = new URLSearchParams();
  if (params.year != null) q.set("year", String(params.year));
  else if (params.period) q.set("period", params.period);
  if (params.back != null) q.set("back", String(params.back));
  if (params.forward != null) q.set("forward", String(params.forward));
  q.set("method", params.method ?? "moving_average");

  const res = await apiFetch(`/reports/monthly-trend?${q.toString()}`);
  if (!res.ok) throw new Error("推移データの取得に失敗しました");
  return res.json();
}

// ── ステップ進捗（F-10 オンボーディング）──────────────────────────────
export type OnboardingSteps = {
  hasIncomeBudget: boolean;
  hasExpenseBudget: boolean;
  hasBankAccount: boolean;
  hasPersonalAsset: boolean;
  hasLoan: boolean;
};

export async function fetchOnboardingSteps(): Promise<OnboardingSteps> {
  const res = await apiFetch("/onboarding/steps");
  if (!res.ok) throw new Error("ステップ進捗の取得に失敗しました");
  const json = await res.json();
  return json.data;
}

// ── 実績 ──────────────────────────────────────────────────────────────
export async function fetchAccounts(): Promise<Account[]> {
  const json = await request<{ data?: Account[] }>("/accounts", "勘定科目の取得に失敗しました");
  return json.data ?? [];
}

// 実績 1 行の出どころ（GET /financials/matrix）。セルの内訳で表示する
export type RecordSource = {
  kind: "bank" | "card" | "journal" | "direct";
  date: string | null;
  description: string | null;
  accountName: string | null;
};

// 科目 × 月の表の元になる実績 1 行
export type FinancialRecordRow = {
  id: number;
  amount: number;
  account: { id: number; code: string; name: string; category: string };
  period: { fiscalYear: number; month: number };
  /** 仕訳と連動した実績（金額は仕訳帳から直す） */
  journalEntryId: number | null;
  createdAt: string;
  source: RecordSource;
};

export async function fetchFinancialMatrix(
  year?: number,
): Promise<{ year: number; years: number[]; data: FinancialRecordRow[] }> {
  const json = await request<{ year: number; years?: number[]; data?: FinancialRecordRow[] }>(
    year ? `/financials/matrix?year=${year}` : "/financials/matrix",
    "実績の取得に失敗しました",
  );
  return {
    year: json.year,
    years: json.years ?? [],
    data: (json.data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
  };
}

export async function postFinancialRecord(data: {
  accountCode: string;
  fiscalYear: number;
  month: number;
  amount: number;
}): Promise<void> {
  await request("/financials", "登録に失敗しました", jsonInit("POST", data));
}

// 金額または勘定科目の変更。転記元の銀行/カード明細があればサーバー側で科目も追随する
export async function patchFinancialRecord(
  id: number,
  data: { amount: number } | { accountId: number },
): Promise<void> {
  await request(`/financials/${id}`, "更新に失敗しました", jsonInit("PATCH", data));
}

export async function deleteFinancialRecord(id: number): Promise<void> {
  await request(`/financials/${id}`, "削除に失敗しました", { method: "DELETE" });
}

export async function fetchRecordHistory(q: HistoryQuery): Promise<HistoryPage> {
  const json = await request<{
    data?: (Omit<ChangeHistoryRow, "targetId"> & { recordId: number | null })[];
    total?: number;
  }>(`/financials/recent?${historyParams(q)}`, "履歴の取得に失敗しました");
  return {
    data: (json.data ?? []).map(({ recordId, ...h }) => ({ ...h, targetId: recordId })),
    total: json.total ?? 0,
  };
}

// ── 日次の入出金（実績管理のカレンダー。GET/POST/DELETE /actuals）──────────────
export type ActualEntry = {
  id: number;
  transactionDate: string;
  description: string;
  paymentMethod: string;
  details: {
    id: number;
    side: "debit" | "credit";
    amount: number;
    account: Account;
  }[];
};

export async function fetchActuals(year: number, month: number): Promise<ActualEntry[]> {
  const json = await request<{ data?: ActualEntry[] }>(
    `/actuals?year=${year}&month=${month}`,
    "実績の取得に失敗しました",
  );
  return json.data ?? [];
}

export async function postActual(data: {
  date: string;
  description: string;
  accountCode: string;
  counterAccountCode: string;
  amount: number;
  direction: "income" | "expense";
  paymentMethod: string;
}): Promise<void> {
  await request("/actuals", "登録に失敗しました", jsonInit("POST", data));
}

export async function deleteActual(id: number): Promise<void> {
  await request(`/actuals?id=${id}`, "削除に失敗しました", { method: "DELETE" });
}

// ── 総資産サマリ（実物資産・銀行口座残高・ローンを含む純資産）──────────────
export type NetWorthSummary = {
  year: number;
  month: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: { key: string; label: string; amount: number }[];
};

export async function fetchNetWorthSummary(): Promise<NetWorthSummary> {
  return request<NetWorthSummary>("/assets/summary", "総資産サマリの取得に失敗しました");
}

// ── 予算 ──────────────────────────────────────────────────────────────
// GET /budgets の 1 行（web 版 予算管理と同じ形）
export type BudgetRow = {
  id: number;
  amount: number;
  account: { id: number; code: string; name: string; category: string };
  period: { fiscalYear: number; month: number };
};

// ローン返済の自動計上分（住宅ローンに限らず全ローン）
export type LoanOverlayRow = {
  accountId: number;
  accountCode: string;
  month: number;
  amount: number;
};

// 実物資産に紐付く負債の残高を解消予定月まで月割りした自動計上分
export type PersonalAssetDebtOverlayRow = {
  accountId: number;
  accountCode: string;
  assetName: string;
  month: number;
  amount: number;
};

export type BudgetResponse = {
  budgets: BudgetRow[];
  /** 期間が登録済みの年度（昇順） */
  years: number[];
  loanOverlay: LoanOverlayRow[];
  personalAssetDebtOverlay: PersonalAssetDebtOverlayRow[];
};

export async function fetchBudgets(year: number): Promise<BudgetResponse> {
  const json = await request<{
    data?: BudgetRow[];
    years?: number[];
    loanOverlay?: LoanOverlayRow[];
    personalAssetDebtOverlay?: PersonalAssetDebtOverlayRow[];
  }>(`/budgets?year=${year}`, "予算データの取得に失敗しました");
  return {
    budgets: (json.data ?? []).map((b) => ({ ...b, amount: Number(b.amount) })),
    years: json.years ?? [],
    loanOverlay: json.loanOverlay ?? [],
    personalAssetDebtOverlay: json.personalAssetDebtOverlay ?? [],
  };
}

// 登録・更新（同じ科目・月があれば上書き）
export async function postBudget(data: {
  accountCode: string;
  fiscalYear: number;
  month: number;
  amount: number;
}): Promise<void> {
  await request("/budgets", "予算の保存に失敗しました", jsonInit("POST", data));
}

export async function deleteBudget(id: number): Promise<void> {
  await request(`/budgets/${id}`, "予算の削除に失敗しました", { method: "DELETE" });
}

// 収入実績 × 予算配分ルールの割合による「適正金額」（予算表の補助表示）
export type AllocationGuideRow = {
  accountId: number;
  accountCode: string;
  month: number;
  amount: number;
};

export async function fetchAllocationGuide(year: number): Promise<AllocationGuideRow[]> {
  const json = await request<{ data?: AllocationGuideRow[] }>(
    `/budgets/allocation-guide?year=${year}`,
    "適正金額の取得に失敗しました",
  );
  return json.data ?? [];
}

// ── 変更履歴（予算・実績で同じ形）─────────────────────────────────────
export type HistorySort = "changedAt" | "account" | "amount";
export type HistoryQuery = {
  limit: number;
  offset: number;
  sort: HistorySort;
  order: "asc" | "desc";
};

export type ChangeHistoryRow = {
  historyId: number;
  /** 予算履歴は budgetId、実績履歴は recordId（削除済みは null） */
  targetId: number | null;
  action: "create" | "update" | "delete" | string;
  amount: number;
  changedAt: string;
  account: Account;
  period: { fiscalYear: number; month: number };
};

export type HistoryPage = { data: ChangeHistoryRow[]; total: number };

function historyParams(q: HistoryQuery): string {
  return `limit=${q.limit}&offset=${q.offset}&sort=${q.sort}&order=${q.order}`;
}

export async function fetchBudgetHistory(year: number, q: HistoryQuery): Promise<HistoryPage> {
  const json = await request<{
    data?: (Omit<ChangeHistoryRow, "targetId"> & { budgetId: number | null })[];
    total?: number;
  }>(`/budgets/history?year=${year}&${historyParams(q)}`, "履歴の取得に失敗しました");
  return {
    data: (json.data ?? []).map(({ budgetId, ...h }) => ({ ...h, targetId: budgetId })),
    total: json.total ?? 0,
  };
}

// ── 予算配分ルール（テナント別マスタ。web 版 予算管理の「予算配分」タブと同じ）──────
export const ALLOCATION_GROUPS = ["固定費", "生活費", "その他"] as const;
export type AllocationGroup = (typeof ALLOCATION_GROUPS)[number];

export type AllocationRule = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  note: string | null;
  sortOrder: number;
  account: { id: number; code: string; name: string } | null;
};

export type AllocationRuleInput = {
  key: string;
  label: string;
  group: string;
  minPercent: number;
  /** null = 上限なし */
  maxPercent: number | null;
  note: string | null;
  /** 対応科目コード（null = 紐付け解除） */
  accountCode: string | null;
};

export async function fetchAllocationRules(): Promise<AllocationRule[]> {
  const json = await request<{ data?: AllocationRule[] }>(
    "/allocation-rules",
    "予算配分ルールの取得に失敗しました",
  );
  return json.data ?? [];
}

export async function saveAllocationRules(
  items: AllocationRuleInput[],
  removedKeys: string[],
): Promise<AllocationRule[]> {
  const json = await request<{ data?: AllocationRule[] }>(
    "/allocation-rules",
    "予算配分ルールの保存に失敗しました",
    jsonInit("PUT", { items, removedKeys: removedKeys.length ? removedKeys : undefined }),
  );
  return json.data ?? [];
}

// FP 推奨の既定ルールを取り込む（同じ key が既にある行はサーバー側で維持される）
export async function importDefaultAllocationRules(): Promise<{
  rules: AllocationRule[];
  created: number;
}> {
  const json = await request<{ data?: AllocationRule[]; created?: number }>(
    "/allocation-rules/defaults",
    "既定ルールの取り込みに失敗しました",
    { method: "POST" },
  );
  return { rules: json.data ?? [], created: json.created ?? 0 };
}

// ── 配分提案（GET /budgets/allocation-suggest。計算はサーバー側）──────────────
export type AllocationBasis = "manual" | "actual" | "budget";

export type AllocationSuggestion = {
  year: number;
  month: number;
  basis: AllocationBasis;
  basisAmount: number;
  /** 配分可能額（手入力は基準額と同じ。実績・予算はローン等控除後） */
  available: number;
  items: {
    rule: {
      id: number;
      key: string;
      label: string;
      group: string;
      minPercent: number;
      maxPercent: number | null;
      accountId: number | null;
      sortOrder: number;
    };
    min: number;
    max: number | null;
    recommended: number;
  }[];
  totalRecommended: number;
  overRecommended: boolean;
  summary503020: { needs: number; wants: number; savings: number };
};

export async function fetchAllocationSuggestion(params: {
  year: number;
  month: number;
  basis: AllocationBasis;
  amount?: number;
}): Promise<AllocationSuggestion> {
  const amount = params.basis === "manual" ? `&amount=${params.amount ?? 0}` : "";
  const json = await request<{ data: AllocationSuggestion }>(
    `/budgets/allocation-suggest?year=${params.year}&month=${params.month}&basis=${params.basis}${amount}`,
    "配分提案の取得に失敗しました",
  );
  return json.data;
}

// 推奨額を対応科目の予算へ一括反映する（POST /budgets/allocation-apply）
export async function applyAllocationToBudget(
  year: number,
  items: { accountId: number; month: number; amount: number }[],
): Promise<void> {
  await request(
    "/budgets/allocation-apply",
    "予算への反映に失敗しました",
    jsonInit("POST", { year, items }),
  );
}

// ── 銀行口座 ──────────────────────────────────────────────────────────
export type BankAccount = {
  id: number;
  name: string;
  bankName: string;
  branchName: string | null;
  accountType: string;
  accountNumber: string | null;
  lastFour: string | null;
  note: string | null;
  account: { id: number; code: string; name: string } | null;
  /** 明細合計 + 差額（web/src/lib/bank-balance.ts の定義） */
  balance: number;
  /** 明細の増減合計だけの残高 */
  transactionSum: number;
  /** 明細に現れない差額（期首残高相当） */
  balanceAdjustment: number;
  /** 明細を最後に登録した日時。明細が無ければ口座の登録日時 */
  lastUpdatedAt: string | null;
  /** 明細上の最新の取引日 */
  lastTransactionDate: string | null;
  _count: { transactions: number };
};

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const json = await request<{ data?: BankAccount[] }>(
    "/bank-accounts",
    "銀行口座の取得に失敗しました",
  );
  return json.data ?? [];
}

export type BankAccountInput = {
  name: string;
  bankName: string;
  branchName?: string;
  accountType?: string;
  accountNumber?: string;
  lastFour?: string;
  accountCode?: string;
  note?: string;
};

export async function postBankAccount(data: BankAccountInput): Promise<void> {
  await request("/bank-accounts", "口座の登録に失敗しました", jsonInit("POST", data));
}

export async function patchBankAccount(
  id: number,
  data: {
    name: string;
    bankName: string;
    lastFour: string;
    accountCode: string;
    note: string;
    balanceAdjustment: number;
  },
): Promise<void> {
  await request(`/bank-accounts/${id}`, "口座の更新に失敗しました", jsonInit("PATCH", data));
}

export async function deleteBankAccount(id: number): Promise<void> {
  await request(`/bank-accounts/${id}`, "口座の削除に失敗しました", { method: "DELETE" });
}

// ── 入出金明細 ────────────────────────────────────────────────────────
export type BankTransaction = {
  id: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  accountId: number;
  source: "MANUAL" | "CSV" | "SYNC";
  /** 紐付けた収入・支払項目（未紐付けは null） */
  categoryAccountId: number | null;
  categoryAccount: { id: number; code: string; name: string } | null;
  /** 実績へ転記済みなら FinancialRecord の id */
  postedRecordId: number | null;
  /** 口座間振替の対。値があると科目紐付け・転記の対象外 */
  transferGroupId: string | null;
  /** デビット・プリペイド・電子マネーへのチャージ先。値があると科目紐付け・転記の対象外 */
  chargeToAccountId: number | null;
  chargeToAccount: { id: number; name: string } | null;
  /** チャージ先の明細と対になっていれば値が入る */
  chargeGroupId: string | null;
};

export async function fetchBankTransactions(accountId: number): Promise<BankTransaction[]> {
  const json = await request<{ data?: BankTransaction[] }>(
    `/bank-accounts/${accountId}/transactions`,
    "入出金明細の取得に失敗しました",
  );
  return (json.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
}

// 手動登録（収入は正、支出は負の金額）
export async function postBankTransaction(
  accountId: number,
  data: { date: string; description: string; amount: number },
): Promise<void> {
  await request(
    `/bank-accounts/${accountId}/transactions`,
    "登録に失敗しました",
    jsonInit("POST", data),
  );
}

// 振替の明細を消すと相手口座の明細も一緒に消える（サーバー側）
export async function deleteBankTransaction(accountId: number, txnId: number): Promise<void> {
  await request(`/bank-accounts/${accountId}/transactions?txnId=${txnId}`, "削除に失敗しました", {
    method: "DELETE",
  });
}

// チャージの指定・解除。pairTxnId を渡すとチャージ先に入った明細と対にする
export async function setBankTransactionCharge(
  txnId: number,
  chargeToAccountId: number | null,
  pairTxnId: number | null = null,
): Promise<void> {
  await request(
    `/bank-transactions/${txnId}/charge`,
    "変更に失敗しました",
    jsonInit("PATCH", { chargeToAccountId, pairTxnId }),
  );
}

// ── 口座間振替（都度）と取込済み明細の振替紐付け ───────────────────────
export async function postBankTransfer(data: {
  date: string;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  description: string | null;
}): Promise<void> {
  await request("/bank-transfers", "振替の登録に失敗しました", jsonInit("POST", data));
}

export type TransferCandidateSide = {
  id: number;
  accountId: number;
  accountName: string;
  bankName: string;
  date: string;
  description: string;
  amount: number;
  categoryAccountId: number | null;
};

export type TransferCandidate = {
  out: TransferCandidateSide;
  in: TransferCandidateSide;
  amount: number;
  dayGap: number;
};

export async function fetchTransferCandidates(
  maxDayGap: number,
): Promise<{ data: TransferCandidate[]; total: number }> {
  const json = await request<{ data?: TransferCandidate[]; total?: number }>(
    `/bank-transfers/candidates?maxDayGap=${maxDayGap}`,
    "振替候補の取得に失敗しました",
  );
  return { data: json.data ?? [], total: json.total ?? 0 };
}

export async function linkBankTransfer(outTxnId: number, inTxnId: number): Promise<void> {
  await request(
    "/bank-transfers/link",
    "紐付けに失敗しました",
    jsonInit("POST", { outTxnId, inTxnId }),
  );
}

export async function unlinkBankTransfer(transferGroupId: string): Promise<void> {
  await request(
    `/bank-transfers/link?transferGroupId=${encodeURIComponent(transferGroupId)}`,
    "解除に失敗しました",
    { method: "DELETE" },
  );
}

// ── 残高推移・資金繰り・月次の実績フロー ─────────────────────────────────
export type TrendGranularity = "month" | "day";
export type BalanceTrendPoint = {
  /** 月次は "YYYY-MM"、日次は "YYYY-MM-DD" */
  month?: string;
  date?: string;
  balances: Record<number, number>;
  /** 資金移動ルールからの推測値 */
  estimated: boolean;
};

export async function fetchBalanceTrend(params: {
  year: number;
  month: number;
  granularity: TrendGranularity;
}): Promise<{ accounts: { id: number; name: string }[]; points: BalanceTrendPoint[] }> {
  const json = await request<{
    accounts?: { id: number; name: string }[];
    points?: BalanceTrendPoint[];
  }>(
    `/bank-accounts/balance-trend?year=${params.year}&month=${params.month}&before=6&after=6&granularity=${params.granularity}`,
    "残高推移の取得に失敗しました",
  );
  return { accounts: json.accounts ?? [], points: json.points ?? [] };
}

export type FundingEvent = { date: string; label: string; amount: number; balanceAfter: number };
export type FundingPlan = {
  accountId: number;
  accountName: string;
  opening: number;
  closing: number;
  minBalance: number;
  minBalanceDate: string | null;
  requiredDeposit: number;
  deadline: string | null;
  trigger: FundingEvent | null;
  events: FundingEvent[];
};
export type FundingResponse = {
  year: number;
  month: number;
  months: number;
  plans: FundingPlan[];
};

export async function fetchFundingPlan(
  year: number,
  month: number,
  months = 3,
): Promise<FundingResponse> {
  return request<FundingResponse>(
    `/transfers/funding?year=${year}&month=${month}&months=${months}`,
    "資金繰りの計算に失敗しました",
  );
}

export type MonthlyCashFlowResponse = {
  year: number;
  month: number;
  graph: FlowGraph;
  /** 推測で補ったフローの本数と、推測に使った過去の月数 */
  estimatedCount?: number;
  historyMonths?: number;
};

export async function fetchMonthlyCashFlow(
  year: number,
  month: number,
): Promise<MonthlyCashFlowResponse> {
  return request<MonthlyCashFlowResponse>(
    `/cashflow/monthly?year=${year}&month=${month}`,
    "実績フローの取得に失敗しました",
  );
}

// チャージ先の履歴から対になる明細の候補（銀行・カードのチャージ指定で共通）
export type ChargeCandidate = {
  id: number;
  date: string;
  description: string;
  amount: number;
  categoryAccount: { id: number; code: string; name: string } | null;
  dayGap: number;
  amountMatch: boolean;
  incoming: boolean;
};

export async function fetchChargeCandidates(params: {
  targetAccountId: number;
  amount: number;
  date: string;
}): Promise<ChargeCandidate[]> {
  const q = new URLSearchParams({
    targetAccountId: String(params.targetAccountId),
    amount: String(params.amount),
    date: params.date.slice(0, 10),
  });
  const json = await request<{ data?: ChargeCandidate[] }>(
    `/charge-links/candidates?${q}`,
    "候補の取得に失敗しました",
  );
  return json.data ?? [];
}

// ── カード・電子マネー ────────────────────────────────────────────────
// web 版 /card-transactions と同じ LinkedAccount（CREDIT_CARD / DEBIT_CARD / PREPAID_CARD / E_MONEY）
export type LinkedAccount = {
  id: number;
  name: string;
  type: "CREDIT_CARD" | "DEBIT_CARD" | "PREPAID_CARD" | "E_MONEY";
  institution: string;
  lastFour: string | null;
  note?: string | null;
  account?: { id: number; code: string; name: string } | null;
  /** このカードをチャージ先に指定している明細の件数（種別をクレジットへ戻すときの警告に使う） */
  chargeSourceCount?: number;
};

export async function fetchLinkedAccounts(): Promise<LinkedAccount[]> {
  const json = await request<{ data?: LinkedAccount[] }>(
    "/linked-accounts",
    "カード・電子マネーの取得に失敗しました",
  );
  return json.data ?? [];
}

export type LinkedAccountInput = {
  name: string;
  type: LinkedAccount["type"];
  institution: string;
  lastFour?: string;
  accountCode?: string;
  note?: string;
};

export async function postLinkedAccount(data: LinkedAccountInput): Promise<LinkedAccount> {
  const json = await request<{ data: LinkedAccount }>(
    "/linked-accounts",
    "保存に失敗しました",
    jsonInit("POST", data),
  );
  return json.data;
}

// 編集時の空文字は「未設定に戻す」
export async function patchLinkedAccount(id: number, data: LinkedAccountInput): Promise<void> {
  await request(`/linked-accounts/${id}`, "保存に失敗しました", jsonInit("PATCH", data));
}

export async function deleteLinkedAccount(id: number): Promise<void> {
  await request(`/linked-accounts/${id}`, "削除に失敗しました", { method: "DELETE" });
}

export type CardTransaction = {
  id: number;
  date: string;
  description: string;
  /** +利用（支出） / -返金 */
  amount: number;
  source: "MANUAL" | "CSV" | "SYNC";
  categoryAccountId: number | null;
  categoryAccount: { id: number; code: string; name: string } | null;
  postedRecordId: number | null;
  /** 他カード・電子マネーへのチャージ先。値があれば科目紐付け・転記の対象外 */
  transferToAccountId: number | null;
  transferToAccount: { id: number; name: string } | null;
  /**
   * チャージ元とチャージ先の明細を対にする識別子。transferToAccountId が無いのにこれだけ持つ行は
   * 「チャージ先に入った入金側」で、こちらも収入として計上しない
   */
  chargeGroupId: string | null;
};

export async function fetchCardTransactions(accountId: number): Promise<CardTransaction[]> {
  const json = await request<{ data?: CardTransaction[] }>(
    `/linked-accounts/${accountId}/transactions`,
    "利用明細の取得に失敗しました",
  );
  return (json.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
}

// 利用は正、返金は負の金額で登録する（web 版の手動登録と同じ符号）
export async function postCardTransaction(
  accountId: number,
  data: { date: string; description: string; amount: number },
): Promise<void> {
  await request(
    `/linked-accounts/${accountId}/transactions`,
    "利用明細の登録に失敗しました",
    jsonInit("POST", data),
  );
}

export async function deleteCardTransaction(accountId: number, txnId: number): Promise<void> {
  await request(
    `/linked-accounts/${accountId}/transactions?txnId=${txnId}`,
    "利用明細の削除に失敗しました",
    { method: "DELETE" },
  );
}

// チャージ（他カード・電子マネーへの資金移動）の指定・解除。pairTxnId でチャージ先の明細と対にする
export async function setCardTransactionCharge(
  txnId: number,
  transferToAccountId: number | null,
  pairTxnId: number | null = null,
): Promise<void> {
  await request(
    `/card-transactions/${txnId}/transfer`,
    "変更に失敗しました",
    jsonInit("PATCH", { transferToAccountId, pairTxnId }),
  );
}

// カードの固定決済（毎月このカードで決済されるサブスク等）。銀行口座は持たない
export type CardRecurringPayment = {
  id: number;
  accountId: number;
  label: string;
  amount: number;
  day: number;
  categoryAccountId: number | null;
};

export async function fetchCardRecurringPayments(
  accountId: number,
): Promise<CardRecurringPayment[]> {
  const json = await request<{ data?: CardRecurringPayment[] }>(
    `/card-recurring-payments?accountId=${accountId}`,
    "固定決済の取得に失敗しました",
  );
  return (json.data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function postCardRecurringPayment(data: {
  accountId: number;
  label: string;
  day: number;
  amount: number;
  categoryAccountId: number | null;
}): Promise<void> {
  await request("/card-recurring-payments", "登録に失敗しました", jsonInit("POST", data));
}

export async function patchCardRecurringPayment(
  id: number,
  data: { day: number; amount: number },
): Promise<void> {
  await request(
    `/card-recurring-payments/${id}`,
    "書き換えに失敗しました",
    jsonInit("PATCH", data),
  );
}

export async function deleteCardRecurringPayment(id: number): Promise<void> {
  await request(`/card-recurring-payments/${id}`, "解除に失敗しました", { method: "DELETE" });
}

// 取込時に自動でチャージ扱いにするルール（確認と削除のみ。web 版と同じ）
export type CardTransferRule = {
  id: number;
  accountId: number;
  keyword: string;
  transferToAccountId: number;
  transferToAccount: { id: number; name: string };
};

export async function fetchCardTransferRules(accountId: number): Promise<CardTransferRule[]> {
  const json = await request<{ data?: CardTransferRule[] }>(
    `/card-transfer-rules?accountId=${accountId}`,
    "ルールの取得に失敗しました",
  );
  return json.data ?? [];
}

export async function deleteCardTransferRule(id: number): Promise<void> {
  await request(`/card-transfer-rules?id=${id}`, "ルールの削除に失敗しました", {
    method: "DELETE",
  });
}

// カード・電子マネーの資金フロー図（引き落とし・チャージ・固定決済）とスケジュールの元データ
export type CardFlowResponse = {
  cyclic: boolean;
  graph: FlowGraph;
  /** チャージを月あたりに均すのに使った月数 */
  chargeMonths: number;
  /** 引き落とし・チャージ・固定決済のどれにも現れないカード */
  unlinked: { id: number; name: string; type: string }[];
  transfers: {
    id: number;
    from: string | null;
    linkedAccountId: number | null;
    linkedAccountName: string | null;
    amount: number;
    channel: string;
    channelLabel: string;
    label: string | null;
    day: number;
    note: string | null;
  }[];
  recurring: {
    id: number;
    accountId: number;
    accountName: string;
    label: string;
    amount: number;
    day: number;
  }[];
};

export async function fetchCardFlow(): Promise<CardFlowResponse> {
  const json = await request<Partial<CardFlowResponse>>(
    "/linked-accounts/flow",
    "フローデータの取得に失敗しました",
  );
  return {
    cyclic: json.cyclic ?? false,
    graph: json.graph ?? { nodes: [], links: [] },
    chargeMonths: json.chargeMonths ?? 3,
    unlinked: json.unlinked ?? [],
    transfers: (json.transfers ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
    recurring: (json.recurring ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
  };
}

// ── 科目紐付け・実績転記（銀行 / カード共通）────────────────────────────
// エンドポイントは web 版と同じ PATCH /{bank|card}-transactions/{id}/categorize。
export type TxnKind = "bank" | "card";

const categorizePath = (kind: TxnKind, txnId: number) =>
  `/${kind}-transactions/${txnId}/categorize`;

/** 明細に科目を紐付ける（null で未紐付けに戻す） */
export async function categorizeTransaction(
  kind: TxnKind,
  txnId: number,
  categoryAccountId: number | null,
): Promise<void> {
  await request(
    categorizePath(kind, txnId),
    "科目の設定に失敗しました",
    jsonInit("PATCH", { categoryAccountId }),
  );
}

/**
 * 明細を実績へ転記する。web 版と同じく learn=true で摘要を学習し、
 * 同じ摘要で科目未設定の明細にも科目を一括適用する（その件数を返す）。
 */
export async function postTransactionToActuals(
  kind: TxnKind,
  txnId: number,
): Promise<{ updatedSiblingCount: number }> {
  const json = await request<{ updatedSiblingCount?: number }>(
    categorizePath(kind, txnId),
    "実績への転記に失敗しました",
    jsonInit("PATCH", { post: true, learn: true }),
  );
  return { updatedSiblingCount: json?.updatedSiblingCount ?? 0 };
}

// ── 資金移動ルール（固定の入出金。毎月の予定）────────────────────────────
// 向きは fromAccountId / toAccountId で表す（from あり＝その口座からの出金、to あり＝その口座への入金）
export type Transfer = {
  id: number;
  label: string | null;
  channel: string;
  kind: string;
  day: number;
  amount: number;
  note: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  fromAccount: { id: number; name: string; bankName: string } | null;
  toAccount: { id: number; name: string; bankName: string } | null;
  linkedAccountId: number | null;
  linkedAccount: { id: number; name: string; type: string; institution: string } | null;
};

export async function fetchTransfers(): Promise<Transfer[]> {
  const json = await request<{ data?: Transfer[] }>(
    "/transfers",
    "固定の入出金の取得に失敗しました",
  );
  return (json.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) }));
}

export type TransferInput = {
  fromAccountId: number | null;
  toAccountId: number | null;
  label: string | null;
  channel: string;
  day: number;
  amount: number;
  note?: string | null;
  kind?: "AUTO" | "MANUAL";
  linkedAccountId?: number | null;
};

export async function postTransfer(data: TransferInput): Promise<void> {
  await request("/transfers", "追加に失敗しました", jsonInit("POST", { kind: "AUTO", ...data }));
}

export async function patchTransfer(
  id: number,
  data: Partial<Pick<TransferInput, "day" | "amount" | "label">>,
): Promise<void> {
  await request(`/transfers/${id}`, "更新に失敗しました", jsonInit("PATCH", data));
}

export async function deleteTransfer(id: number): Promise<void> {
  await request(`/transfers/${id}`, "削除に失敗しました", { method: "DELETE" });
}

export type FlowGraph = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number; estimated?: boolean }[];
};

// 資金フロー図（設定ベース）と、登録済みルールの一覧
export type TransferFlowRow = {
  id: number;
  from: string | null;
  to: string | null;
  amount: number;
  kind: string;
  channel: string;
  channelLabel: string;
  label: string | null;
  day: number;
  note: string | null;
};

export type TransferFlowResponse = {
  cyclic: boolean;
  graph: FlowGraph;
  transfers: TransferFlowRow[];
};

export async function fetchTransferFlow(): Promise<TransferFlowResponse> {
  const json = await request<Partial<TransferFlowResponse>>(
    "/transfers/flow",
    "フローデータの取得に失敗しました",
  );
  return {
    cyclic: json.cyclic ?? false,
    graph: json.graph ?? { nodes: [], links: [] },
    transfers: (json.transfers ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
  };
}

// ── 借入金 ────────────────────────────────────────────────────────────
// 型は web と共有する（shared/loan-schedule.ts。金利変更履歴・返済履歴を含む）
export type { Loan };

export async function fetchLoans(): Promise<Loan[]> {
  const json = await request<{ data?: Loan[] }>("/loans", "借入金の取得に失敗しました");
  return json.data ?? [];
}

// 年利率は小数（0.03 = 3%）で送る（web 版と同じ）
export async function postLoan(data: {
  lenderName: string;
  amount: number;
  interestRate: number;
  borrowedOn: string;
  repaymentDate: string;
  note?: string;
  loanType: string;
  linkedAccountCode?: string;
  monthlyPayment?: number;
}): Promise<void> {
  await request("/loans", "借入金の登録に失敗しました", jsonInit("POST", data));
}

// 借入条件の編集（支払い完了年月・月々の返済額・残価・予算連携先）
export async function patchLoan(
  id: number,
  data: {
    repaymentDate: string;
    monthlyPayment: number | null;
    residualValue: number | null;
    linkedAccountCode: string | null;
  },
): Promise<void> {
  await request(`/loans/${id}`, "借入金の更新に失敗しました", jsonInit("PATCH", data));
}

export async function repayLoan(
  id: number,
  data: { repaidOn: string; principal: number; interest: number },
): Promise<void> {
  await request(`/loans/${id}/repay`, "返済の登録に失敗しました", jsonInit("POST", data));
}

// 金利変更の登録。最新の変更なら現在金利も更新され、月々の返済額は実額が入力されたときだけ反映される
export async function postLoanRateChange(
  id: number,
  data: { effectiveOn: string; interestRate: number; monthlyPayment: number | null; note?: string },
): Promise<void> {
  await request(
    `/loans/${id}/interest-rates`,
    "金利変更の登録に失敗しました",
    jsonInit("POST", data),
  );
}

// 金利改定後の実額（金融機関の通知額）を後から入力する
export async function patchLoanRateChange(
  id: number,
  changeId: number,
  monthlyPayment: number,
): Promise<void> {
  await request(
    `/loans/${id}/interest-rates/${changeId}`,
    "返済額の反映に失敗しました",
    jsonInit("PATCH", { monthlyPayment }),
  );
}

// ── 実物資産（土地・建物・車・金など）──────────────────────────────
export type PersonalAsset = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string | null;
  acquisitionCost: number | string | null;
  currentValue: number | string;
  /** 純資産に評価額を計上するか。false = 負債のみ反映（ローンの諸費用等） */
  countAsAsset: boolean;
  note: string | null;
  linkedAccountId: number | null;
  debtStartOn: string | null; // 支払い開始年月
  debtPayoffDue: string | null; // 負債解消（完済）予定年月
  debtInitialAmount: number | string | null; // 当初負債額
  /** 年利（小数。0.0081 = 0.810%） */
  debtInterestRate: number | string | null;
  /** 残価設定ローンの据置額（最終回に一括支払い）。null / 0 = 通常ローン */
  debtResidualValue: number | string | null;
  debtMonthly: number | null; // 月額（サーバー計算）
  debtRemaining: number | null; // 現在の負債残高（サーバー計算）
  debtRemainingMonths: number | null; // 残り支払い回数（サーバー計算）
  createdAt: string;
  updatedAt: string;
};

export async function fetchPersonalAssets(): Promise<PersonalAsset[]> {
  const json = await request<{ data?: PersonalAsset[] }>(
    "/personal-assets",
    "資産の取得に失敗しました",
  );
  return json.data ?? [];
}

export type PersonalAssetInput = {
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string | null;
  acquisitionCost: number | null;
  currentValue: number;
  countAsAsset: boolean;
  note: string | null;
  linkedAccountId: number | null;
  debtStartOn: string | null;
  debtPayoffDue: string | null;
  debtInitialAmount: number | null;
  debtInterestRate: number | null;
  debtResidualValue: number | null;
};

// 新規登録は未入力の項目を送らない（サーバー側の既定値に任せる）
export async function postPersonalAsset(data: PersonalAssetInput): Promise<void> {
  const body = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== ""));
  await request("/personal-assets", "保存に失敗しました", jsonInit("POST", body));
}

export async function patchPersonalAsset(
  id: number,
  data: Partial<PersonalAssetInput>,
): Promise<void> {
  await request(`/personal-assets/${id}`, "更新に失敗しました", jsonInit("PATCH", data));
}

export async function deletePersonalAsset(id: number): Promise<void> {
  await request(`/personal-assets/${id}`, "資産の削除に失敗しました", { method: "DELETE" });
}

// ── 仕訳帳（閲覧のみ。入力・承認・証憑の添付は web 版）──────────────────────────
export type JournalEntry = {
  id: number;
  transactionDate: string;
  description: string;
  paymentMethod: string;
  taxCategory: string;
  approvalStatus: string;
  details: { id: number; side: string; amount: number; note: string | null; account: Account }[];
  receipts: { id: number; fileName: string; fileType: string }[];
};

// web 版 仕訳帳と同じく年月で絞り込む（最大 100 件）
export async function fetchJournals(
  year: number,
  month: number,
): Promise<{ data: JournalEntry[]; total: number }> {
  const json = await request<{ data?: JournalEntry[]; total?: number }>(
    `/journals?year=${year}&month=${month}&limit=100`,
    "仕訳帳の取得に失敗しました",
  );
  return { data: json.data ?? [], total: json.total ?? 0 };
}

// ── インボイス（閲覧のみ。作成・発行・入金・削除は web 版）──────────────────────────
export type Invoice = {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerAddress: string | null;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  note: string | null;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    amount: string;
  }[];
};

export async function fetchInvoices(): Promise<Invoice[]> {
  const json = await request<{ data?: Invoice[] }>("/invoices", "インボイスの取得に失敗しました");
  return json.data ?? [];
}

// ── 決算（閲覧のみ。決算確定・申告書類・e-Tax XML は web 版）──────────────────────
export type ClosingAccountRow = {
  accountId: number;
  code: string;
  name: string;
  soleName?: string | null;
  corporateName?: string | null;
  category: string;
  total: number;
  businessRate?: number;
  deductible?: number;
};

// web 版 /closing と同じ GET /closing/statements の内容
export type ClosingStatements = {
  fiscalYear: number;
  pnl: {
    revenue: ClosingAccountRow[];
    revenueTotal: number;
    cogs: ClosingAccountRow[];
    cogsTotal: number;
    grossProfit: number;
    expenses: ClosingAccountRow[];
    expenseTotal: number;
    expenseDeductible: number;
    netIncome: number;
  };
  bs: {
    assets: ClosingAccountRow[];
    assetTotal: number;
    liabilities: ClosingAccountRow[];
    liabilityTotal: number;
    equity: number;
  };
  ratios: {
    currentRatio: number | null;
    equityRatio: number | null;
    roa: number | null;
    roe: number | null;
    grossProfitRate: number | null;
    operatingMargin: number | null;
  };
  trialBalance: ClosingAccountRow[];
  monthly: Record<string, { revenue: number; cogs: number; expense: number }>;
  closeStatus: { status: string; closedAt: string | null } | null;
};

export async function fetchClosing(year: number): Promise<ClosingStatements> {
  return request<ClosingStatements>(
    `/closing/statements?year=${year}`,
    "決算データの取得に失敗しました",
  );
}

// ── 法人ガバナンス（閲覧のみ。追加・削除は web 版）───────────────────────────────
export type Officer = {
  id: number;
  name: string;
  title: string;
  termStart: string;
  termEnd: string;
  salary: string | null;
};
export type ShareholderMeeting = {
  id: number;
  meetingDate: string;
  meetingType: string;
  agenda: string;
  resolution: string | null;
};
export type Dividend = {
  id: number;
  resolutionDate: string;
  paymentDate: string;
  perShareAmount: string;
  totalAmount: string;
};
export type Announcement = {
  id: number;
  announcementDate: string;
  method: string;
  content: string | null;
  fiscalYear: number;
};
export type Governance = {
  tenants: { id: number; name: string; type: string }[];
  officers: Officer[];
  meetings: ShareholderMeeting[];
  dividends: Dividend[];
  announcements: Announcement[];
};

// web 版 /governance と同じ 5 本の一覧（tenantId 省略で全テナント）
export async function fetchGovernance(tenantId: number | null): Promise<Governance> {
  const qs = tenantId ? `?tenantId=${tenantId}` : "";
  const list = <T>(path: string, label: string) =>
    request<{ data?: T[] }>(path, `${label}の取得に失敗しました`).then((j) => j.data ?? []);
  const [tenants, officers, meetings, dividends, announcements] = await Promise.all([
    list<Governance["tenants"][number]>("/tenants", "テナント"),
    list<Officer>(`/officers${qs}`, "役員情報"),
    list<ShareholderMeeting>(`/shareholder-meetings${qs}`, "株主総会"),
    list<Dividend>(`/dividends${qs}`, "配当"),
    list<Announcement>(`/announcements${qs}`, "決算公告"),
  ]);
  return { tenants, officers, meetings, dividends, announcements };
}

// ── 設定（閲覧のみ。変更は web 版で行う）──────────────────────────────────
export type BusinessProfile = {
  tradeName: string | null;
  ownerName: string | null;
  openedOn: string | null;
  blueReturn: boolean;
  invoiceNumber: string | null;
  taxationType: string | null;
};
export type TaxSetting = { taxYear: number; taxationType: string; simplifiedRate: string | null };
export type Department = { id: number; name: string; manager: string | null };

export type SettingsSnapshot = {
  profile: BusinessProfile | null;
  taxSettings: TaxSetting[];
  mfaEnabled: boolean;
  departments: Department[];
};

export async function fetchSettingsSnapshot(): Promise<SettingsSnapshot> {
  const [profile, tax, me, departments] = await Promise.all([
    request<{ data?: BusinessProfile | null }>(
      "/business-profile",
      "事業者情報の取得に失敗しました",
    ),
    request<{ data?: TaxSetting[] }>("/tax-settings", "消費税設定の取得に失敗しました"),
    request<{ user?: { mfaEnabled?: boolean } }>("/auth/me", "ユーザー情報の取得に失敗しました"),
    request<{ data?: Department[] }>("/departments", "部門の取得に失敗しました"),
  ]);
  return {
    profile: profile.data ?? null,
    taxSettings: tax.data ?? [],
    mfaEnabled: me.user?.mfaEnabled ?? false,
    departments: departments.data ?? [],
  };
}
