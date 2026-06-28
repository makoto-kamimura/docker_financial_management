"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { Locale } from "@/lib/i18n";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Target,
  ClipboardList,
  BookOpen,
  FileStack,
  BookMarked,
  ArrowDownToLine,
  ArrowUpFromLine,
  Receipt,
  Package,
  Building2,
  SplitSquareHorizontal,
  TrendingUp,
  Landmark,
  ArrowLeftRight,
  CreditCard,
  Plug,
  FileBarChart2,
  Building,
  CalendarDays,
  ShieldCheck,
  Settings,
  Users,
  ScrollText,
  ExternalLink,
} from "lucide-react";

export type ViewMode = "household" | "sole" | "corporate";

const VIEW_MODES: { value: ViewMode; label: string; short: string }[] = [
  { value: "household", label: "家計簿", short: "家計" },
  { value: "sole", label: "個人会計", short: "個人" },
  { value: "corporate", label: "法人", short: "法人" },
];

type NavItem = { href: string; label: string; icon: LucideIcon; modes: ViewMode[] };
type NavGroup = { group: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    group: "基本",
    items: [
      {
        href: "/dashboard",
        label: "ダッシュボード",
        icon: LayoutDashboard,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/budget",
        label: "予算管理",
        icon: Target,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/entry",
        label: "実績管理",
        icon: ClipboardList,
        modes: ["household", "sole", "corporate"],
      },
    ],
  },
  {
    group: "会計帳簿",
    items: [
      { href: "/journals", label: "仕訳帳", icon: BookOpen, modes: ["sole", "corporate"] },
      {
        href: "/journal-templates",
        label: "仕訳テンプレート",
        icon: FileStack,
        modes: ["sole", "corporate"],
      },
      {
        href: "/reports/ledger",
        label: "総勘定元帳",
        icon: BookMarked,
        modes: ["sole", "corporate"],
      },
      {
        href: "/receivables",
        label: "売掛金管理",
        icon: ArrowDownToLine,
        modes: ["sole", "corporate"],
      },
      {
        href: "/payables",
        label: "買掛金管理",
        icon: ArrowUpFromLine,
        modes: ["sole", "corporate"],
      },
      { href: "/invoices", label: "インボイス発行", icon: Receipt, modes: ["sole", "corporate"] },
    ],
  },
  {
    group: "資産・経費管理",
    items: [
      { href: "/inventories", label: "棚卸管理", icon: Package, modes: ["sole", "corporate"] },
      { href: "/fixed-assets", label: "固定資産", icon: Building2, modes: ["sole", "corporate"] },
      { href: "/apportionments", label: "家事按分", icon: SplitSquareHorizontal, modes: ["sole"] },
      {
        href: "/assets",
        label: "資産管理",
        icon: TrendingUp,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/bank-accounts",
        label: "銀行管理",
        icon: Landmark,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/bank-transactions",
        label: "入出金管理",
        icon: ArrowLeftRight,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/loans",
        label: "借入金管理",
        icon: CreditCard,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/integrations",
        label: "外部サービス連携",
        icon: Plug,
        modes: ["sole", "corporate"],
      },
    ],
  },
  {
    group: "決算・申告",
    items: [
      { href: "/closing", label: "決算処理", icon: FileBarChart2, modes: ["sole", "corporate"] },
    ],
  },
  {
    group: "法人管理",
    items: [
      { href: "/corporate", label: "法人・事業者情報", icon: Building, modes: ["corporate"] },
      {
        href: "/fiscal-years",
        label: "会計年度管理",
        icon: CalendarDays,
        modes: ["sole", "corporate"],
      },
      { href: "/governance", label: "ガバナンス管理", icon: ShieldCheck, modes: ["corporate"] },
    ],
  },
  {
    group: "設定・管理",
    items: [
      {
        href: "/settings",
        label: "設定",
        icon: Settings,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/admin/users",
        label: "ユーザー管理",
        icon: Users,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/admin/audit",
        label: "監査ログ",
        icon: ScrollText,
        modes: ["household", "sole", "corporate"],
      },
      {
        href: "/portal",
        label: "税理士ポータル",
        icon: ExternalLink,
        modes: ["sole", "corporate"],
      },
    ],
  },
];

const TITLE: Record<ViewMode, string> = {
  household: "家計管理システム",
  sole: "個人会計システム",
  corporate: "法人会計システム",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("sole");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { locale, changeLocale } = useLocale();

  useEffect(() => {
    const saved = localStorage.getItem("viewMode") as ViewMode | null;
    if (saved && ["household", "sole", "corporate"].includes(saved)) {
      setViewMode(saved);
    }
  }, []);

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("viewMode", mode);
    window.dispatchEvent(new CustomEvent("viewmode-change", { detail: mode }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* モバイルオーバーレイ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* モバイルメニューボタン */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="fixed top-3 left-3 z-30 md:hidden bg-slate-800 text-white p-2 rounded-lg shadow-lg"
        aria-label="メニューを開く"
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      <aside
        id="app-sidebar"
        className={`w-56 flex-shrink-0 bg-slate-900 flex flex-col
          fixed md:static inset-y-0 left-0 z-30 transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        aria-label="サイドバーナビゲーション"
      >
        <div className="px-4 py-4 border-b border-slate-700/60">
          <span className="text-white font-semibold text-xs tracking-wide leading-tight block mb-3">
            {TITLE[viewMode]}
          </span>
          {/* 観点切り替え switcher */}
          <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
            {VIEW_MODES.map(({ value, short }) => (
              <button
                key={value}
                type="button"
                onClick={() => changeViewMode(value)}
                className={`flex-1 py-1 font-medium transition-colors ${
                  viewMode === value
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-700"
                }`}
              >
                {short}
              </button>
            ))}
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {NAV_GROUPS.map(({ group, items }) => {
            const visible = items.filter((i) => i.modes.includes(viewMode));
            if (visible.length === 0) return null;
            return (
              <div key={group} className="mb-3">
                <p className="px-3 mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {group}
                </p>
                {visible.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href as never}
                    onClick={() => setSidebarOpen(false)}
                    aria-current={pathname === href ? "page" : undefined}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      pathname === href
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <Icon size={13} strokeWidth={1.8} className="flex-shrink-0 opacity-80" />
                    {label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-700/60 space-y-2">
          {/* 言語切り替え */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
            {(["ja", "en"] as Locale[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => changeLocale(lang)}
                aria-pressed={locale === lang}
                className={`flex-1 py-1 font-medium transition-colors ${
                  locale === lang
                    ? "bg-slate-600 text-white"
                    : "text-slate-500 hover:text-white hover:bg-slate-700"
                }`}
              >
                {lang === "ja" ? "日本語" : "English"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            {locale === "en" ? "Logout" : "ログアウト"}
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-auto min-w-0">
        <main
          id="main-content"
          className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl mx-auto"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
