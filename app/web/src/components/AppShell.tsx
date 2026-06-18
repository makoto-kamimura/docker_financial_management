"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/entry", label: "実績入力" },
  { href: "/masters", label: "マスタ管理" },
  { href: "/reports", label: "予実レポート" },
  { href: "/settings", label: "セキュリティ設定" },
  { href: "/admin/audit", label: "監査ログ" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-700/60">
          <span className="text-white font-semibold text-sm tracking-wide leading-tight">
            決算管理システム
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href as never}
              className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === href
                  ? "bg-indigo-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-700/60">
          <button
            type="button"
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            ログアウト
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-auto">
        <main className="px-8 py-8 max-w-5xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
