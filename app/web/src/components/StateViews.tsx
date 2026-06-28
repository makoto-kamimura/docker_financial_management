// 全画面共通のローディング・エラー・空状態コンポーネント

export function LoadingSpinner({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-400">
      <span className="w-5 h-5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span className="mt-0.5 shrink-0 text-base">⚠️</span>
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="card text-center py-14 text-slate-500">
      <p className="text-3xl mb-3">📭</p>
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="text-xs mt-1 text-slate-400">{description}</p>}
    </div>
  );
}
