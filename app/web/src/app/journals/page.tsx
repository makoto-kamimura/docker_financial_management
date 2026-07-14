"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { useViewMode } from "@/lib/use-view-mode";
import { displayName, type ViewMode } from "@/lib/display-name";

// ── 型定義 ─────────────────────────────────────────────────────────────
type Account = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};
type Detail = { side: "debit" | "credit"; accountId: number; amount: number; note: string };
type JournalDetail = {
  id: number;
  side: string;
  amount: number;
  note: string | null;
  account: Account;
};
type Receipt = { id: number; fileName: string; fileUrl: string; fileType: string };
type JournalEntry = {
  id: number;
  transactionDate: string;
  description: string;
  paymentMethod: string;
  taxCategory: string;
  approvalStatus: string;
  details: JournalDetail[];
  receipts: Receipt[];
};

const APPROVAL_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "下書き", color: "text-slate-500 bg-slate-100" },
  pending: { label: "承認待ち", color: "text-amber-700 bg-amber-100" },
  approved: { label: "承認済", color: "text-green-700 bg-green-100" },
  rejected: { label: "差戻し", color: "text-red-700   bg-red-100" },
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "現金",
  bank: "銀行振込",
  card: "クレジット",
  transfer: "口座引落",
};
const TAX_LABELS: Record<string, string> = {
  taxable: "課税",
  exempt: "非課税",
  non_taxable: "不課税",
};

function yen(v: number) {
  return v.toLocaleString("ja-JP") + "円";
}

// ── 証憑アップロード ────────────────────────────────────────────────────
function ReceiptUploader({
  entryId,
  receipts,
  onUploaded,
}: {
  entryId: number;
  receipts: Receipt[];
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`/api/journals/${entryId}/receipts`, { method: "POST", body: fd });
    onUploaded();
    setUploading(false);
  }

  async function remove(receiptId: number) {
    if (!confirm("この証憑を削除しますか？")) return;
    await fetch(`/api/journals/${entryId}/receipts/${receiptId}`, { method: "DELETE" });
    onUploaded();
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-50 flex items-center gap-3 flex-wrap">
      {receipts.map((r) => (
        <span key={r.id} className="flex items-center gap-1 text-xs">
          <a
            href={r.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-indigo-600 hover:underline"
          >
            <span>{r.fileType === "pdf" ? "📄" : "🖼"}</span>
            <span>{r.fileName}</span>
          </a>
          <button
            type="button"
            onClick={() => remove(r.id)}
            className="text-slate-300 hover:text-red-500"
            aria-label="証憑を削除"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-xs text-slate-400 hover:text-indigo-600 border border-dashed border-slate-200 rounded px-2 py-0.5 hover:border-indigo-300"
      >
        {uploading ? "アップロード中…" : "+ 証憑添付"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── 仕訳入力モーダル ────────────────────────────────────────────────────
function JournalForm({
  accounts,
  onSaved,
  onClose,
  sysMode,
}: {
  accounts: Account[];
  onSaved: () => void;
  onClose: () => void;
  sysMode: ViewMode;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [desc, setDesc] = useState("");
  const [method, setMethod] = useState("cash");
  const [tax, setTax] = useState("taxable");
  const [details, setDetails] = useState<Detail[]>([
    { side: "debit", accountId: 0, amount: 0, note: "" },
    { side: "credit", accountId: 0, amount: 0, note: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateDetail(i: number, field: keyof Detail, val: string | number) {
    setDetails((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: val } : d)));
  }

  function addRow(side: "debit" | "credit") {
    setDetails((prev) => [...prev, { side, accountId: 0, amount: 0, note: "" }]);
  }

  function removeRow(i: number) {
    setDetails((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setErr(null);
    if (!date || !desc) return setErr("取引日と摘要は必須です");
    const filled = details.filter((d) => d.accountId > 0 && d.amount > 0);
    if (filled.length < 2) return setErr("借方・貸方それぞれ1行以上入力してください");

    setSaving(true);
    const res = await fetch("/api/journals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionDate: date,
        description: desc,
        paymentMethod: method,
        taxCategory: tax,
        details: filled.map((d) => ({
          side: d.side,
          accountId: d.accountId,
          amount: d.amount,
          note: d.note || undefined,
        })),
      }),
    });
    if (res.ok) {
      onSaved();
      onClose();
    } else {
      const j = await res.json();
      setErr(j.error ?? "登録に失敗しました");
    }
    setSaving(false);
  }

  const debitRows = details.map((d, i) => ({ ...d, idx: i })).filter((d) => d.side === "debit");
  const creditRows = details.map((d, i) => ({ ...d, idx: i })).filter((d) => d.side === "credit");

  const acctOptions = (side: "debit" | "credit") => {
    const cats =
      side === "debit" ? ["EXPENSE", "COGS", "ASSET"] : ["REVENUE", "LIABILITY", "ASSET"];
    return accounts.filter((a) => cats.includes(a.category));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">仕訳入力</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">
            ✕
          </button>
        </div>
        <div className="p-6 space-y-4">
          {/* ヘッダ情報 */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">取引日 *</span>
              <input
                type="date"
                className="input-field mt-1 w-full"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">支払方法</span>
              <select
                className="input-field mt-1 w-full"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {Object.entries(PAYMENT_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">摘要 *</span>
            <input
              className="input-field mt-1 w-full"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="例: 4月分事務所家賃"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">税区分</span>
              <select
                className="input-field mt-1 w-full"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              >
                {Object.entries(TAX_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 仕訳明細 */}
          <div className="border border-slate-100 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left w-16">区分</th>
                  <th className="px-3 py-2 text-left">勘定科目</th>
                  <th className="px-3 py-2 text-right w-32">金額</th>
                  <th className="px-3 py-2 text-left">摘要</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[...debitRows, ...creditRows].map((row) => (
                  <tr
                    key={row.idx}
                    className={row.side === "debit" ? "bg-blue-50/30" : "bg-orange-50/30"}
                  >
                    <td className="px-3 py-1.5">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          row.side === "debit"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {row.side === "debit" ? "借方" : "貸方"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        className="text-xs border border-slate-200 rounded px-1.5 py-1 w-full"
                        value={row.accountId}
                        onChange={(e) => updateDetail(row.idx, "accountId", Number(e.target.value))}
                      >
                        <option value={0}>科目を選択</option>
                        {acctOptions(row.side).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {displayName(a, sysMode)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        min={0}
                        className="text-xs border border-slate-200 rounded px-1.5 py-1 w-full text-right"
                        value={row.amount || ""}
                        onChange={(e) => updateDetail(row.idx, "amount", Number(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        className="text-xs border border-slate-200 rounded px-1.5 py-1 w-full"
                        value={row.note}
                        onChange={(e) => updateDetail(row.idx, "note", e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {details.filter((d) => d.side === row.side).length > 1 && (
                        <button
                          onClick={() => removeRow(row.idx)}
                          className="text-slate-300 hover:text-red-400 text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => addRow("debit")}
              className="text-xs text-blue-600 hover:underline"
            >
              ＋ 借方行を追加
            </button>
            <button
              onClick={() => addRow("credit")}
              className="text-xs text-orange-600 hover:underline"
            >
              ＋ 貸方行を追加
            </button>
          </div>

          {err && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {err}
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm px-4 py-1.5">
            キャンセル
          </button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm px-5 py-1.5">
            {saving ? "登録中…" : "仕訳を登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインページ ────────────────────────────────────────────────────────
export default function JournalsPage() {
  const sysMode = useViewMode();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then(({ data }) =>
        setAccounts(
          (data as Account[]).filter(
            (a) =>
              !["ASSET", "LIABILITY"].includes(a.category) ||
              a.category === "ASSET" ||
              a.category === "LIABILITY",
          ),
        ),
      );
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/journals?year=${year}&month=${month}&limit=100`);
    const { data, total: t } = await res.json();
    setEntries(data ?? []);
    setTotal(t ?? 0);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [year, month]);

  async function deleteEntry(id: number) {
    if (!confirm("この仕訳を削除しますか？")) return;
    setDeleting(id);
    await fetch(`/api/journals/${id}`, { method: "DELETE" });
    await load();
    setDeleting(null);
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="page-title">仕訳帳</h1>
          <p className="text-sm text-slate-500 mt-0.5">日次取引の仕訳入力・管理（F002）</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm px-4 py-2">
          ＋ 新規仕訳
        </button>
      </div>

      {/* フィルタ */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600">年</label>
          <select
            className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600">月</label>
          <select
            className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-slate-400">{total}件</span>
      </div>

      {loading && <LoadingSpinner />}

      {!loading && entries.length === 0 && (
        <div className="card text-center py-12 text-slate-400 text-sm">
          仕訳データがありません。「＋ 新規仕訳」から入力してください。
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((e) => {
            const debits = e.details.filter((d) => d.side === "debit");
            const credits = e.details.filter((d) => d.side === "credit");
            const total = debits.reduce((s, d) => s + Number(d.amount), 0);
            return (
              <div key={e.id} className="card hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-400">
                      {new Date(e.transactionDate).toLocaleDateString("ja-JP")}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                      {PAYMENT_LABELS[e.paymentMethod] ?? e.paymentMethod}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                      {TAX_LABELS[e.taxCategory] ?? e.taxCategory}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-800">{yen(total)}</span>
                    {(() => {
                      const status = e.approvalStatus ?? "approved";
                      const ap = APPROVAL_LABELS[status] ?? APPROVAL_LABELS.approved;
                      return (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ap.color}`}>
                          {ap.label}
                        </span>
                      );
                    })()}
                    {(e.approvalStatus === "approved" || !e.approvalStatus) && (
                      <button
                        onClick={async () => {
                          await fetch("/api/journals/approve", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ journalEntryId: e.id, action: "submit" }),
                          });
                          load();
                        }}
                        className="text-xs text-amber-600 hover:text-amber-800"
                      >
                        承認申請
                      </button>
                    )}
                    {e.approvalStatus === "pending" && (
                      <>
                        <button
                          onClick={async () => {
                            await fetch("/api/journals/approve", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ journalEntryId: e.id, action: "approve" }),
                            });
                            load();
                          }}
                          className="text-xs text-green-600 hover:text-green-800"
                        >
                          承認
                        </button>
                        <button
                          onClick={async () => {
                            await fetch("/api/journals/approve", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ journalEntryId: e.id, action: "reject" }),
                            });
                            load();
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          差戻し
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => deleteEntry(e.id)}
                      disabled={deleting === e.id}
                      className="text-xs text-slate-300 hover:text-red-400 transition-colors"
                    >
                      {deleting === e.id ? "削除中…" : "削除"}
                    </button>
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-700 mb-2">{e.description}</p>
                <div className="border border-slate-100 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-50">
                      {[...debits, ...credits].map((d) => (
                        <tr
                          key={d.id}
                          className={d.side === "debit" ? "bg-blue-50/20" : "bg-orange-50/20"}
                        >
                          <td className="px-3 py-1.5 w-12">
                            <span
                              className={`font-medium ${d.side === "debit" ? "text-blue-600" : "text-orange-600"}`}
                            >
                              {d.side === "debit" ? "借方" : "貸方"}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-600">
                            <span className="font-mono text-slate-400 mr-1">{d.account.code}</span>
                            {displayName(d.account, sysMode)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium">
                            {yen(Number(d.amount))}
                          </td>
                          <td className="px-3 py-1.5 text-slate-400">{d.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ReceiptUploader entryId={e.id} receipts={e.receipts ?? []} onUploaded={load} />
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <JournalForm
          accounts={accounts}
          onSaved={load}
          onClose={() => setShowForm(false)}
          sysMode={sysMode}
        />
      )}
    </AppShell>
  );
}
