"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { ActualsConfirmPanel } from "@/components/ActualsConfirmPanel";
import { BankTransactionsCalendar } from "@/components/BankTransactionsCalendar";
import { BankTransactionsPanel } from "@/components/BankTransactionsPanel";
import { CardTransactionsPanel } from "@/components/CardTransactionsPanel";
import type { LedgerStatus } from "@/components/LedgerTable";
import { PageHeader, SegmentedControl, Tabs } from "@/components/ui";
import { SectionLead, TermDetails } from "@/components/Explain";
import { useViewMode } from "@/lib/client/use-view-mode";
import { ENTRY_HELP, LEARNING_RULE_TERMS, textFor } from "@/lib/shared/help-texts";
import { ActualsMatrixTab } from "@/components/entry/ActualsMatrixTab";
import { CashCalendarTab } from "@/components/entry/CashCalendarTab";
import { CashHistoryTab } from "@/components/entry/CashHistoryTab";
import { ImportTab } from "@/components/entry/ImportTab";
import { LearningRulesPanel } from "@/components/entry/LearningRulesPanel";
import { type Account, type Source, type SourceAccount } from "@/components/entry/types";
import { useActualsScope } from "@/lib/client/use-view-mode";
import { withScope } from "@/lib/shared/business-use";

// 各タブの中身は components/entry/（現金の一覧・カレンダー・取り込み・履歴）と、銀行・カードの部品に置く
// 並びは 一覧 → カレンダー → 取り込み → 実績の確定 → 履歴 → 設定（予算管理と同じく設定は右端）
// 取り込みのタブの id は、他の画面からのリンク（?tab=csv）を変えないよう csv のまま
type Tab = "manual" | "calendar" | "csv" | "confirm" | "history" | "settings";
const TABS: readonly (readonly [Tab, string])[] = [
  ["manual", "一覧"],
  ["calendar", "カレンダー"],
  ["csv", "取り込み"],
  ["confirm", "実績の確定"],
  ["history", "履歴"],
  ["settings", "設定"],
];

const TAB_IDS: Tab[] = ["manual", "calendar", "csv", "confirm", "history", "settings"];

const SOURCES: [Source, string][] = [
  ["manual", "現金"],
  ["bank", "銀行"],
  ["card", "カード・電子マネー"],
];

// 他の画面から ?tab=confirm&month=YYYY-MM のように開けるようにする（ダッシュボードの状況の 1 行など）。
// 銀行管理・カード管理の「明細を見る」からは ?tab=history&source=bank&account=ID で開く
function useInitialTab(): {
  tab: Tab;
  month: string | undefined;
  source: Source;
  account: number | null;
} {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const month = searchParams.get("month");
  const source = searchParams.get("source");
  const account = Number(searchParams.get("account"));
  return {
    tab: TAB_IDS.includes(tab as Tab) ? (tab as Tab) : "manual",
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    source: source === "bank" || source === "card" ? source : "manual",
    account: Number.isInteger(account) && account > 0 ? account : null,
  };
}

// ── ページ ─────────────────────────────────────────────────────────
export default function EntryPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <EntryContent />
    </Suspense>
  );
}

function EntryContent() {
  const sysMode = useViewMode();

  // ── タブ ──────────────────────────────────────────────────────
  const initial = useInitialTab();
  const [tab, setTab] = useState<Tab>(initial.tab);
  // 履歴の一覧の最初の状態の絞り込み（取り込みの結果から「未割り当て」で開くときだけ変える）
  const [historyStatus, setHistoryStatus] = useState<LedgerStatus>("all");

  // ── 出どころ（カレンダー・履歴で共通）──────────────────────────
  const [source, setSource] = useState<Source>(initial.source);
  // 銀行は null で「すべての銀行」。カードは履歴だけ null で「すべてのカード・電子マネー」
  // （カレンダー・取り込みは 1 枚を選ぶので、null なら最初のカード）
  const [bankAccountId, setBankAccountId] = useState<number | null>(
    initial.source === "bank" ? initial.account : null,
  );
  const [cardAccountId, setCardAccountId] = useState<number | null>(
    initial.source === "card" ? initial.account : null,
  );
  // 出どころを選ぶタブ。取り込みでは取り込み先になる（現金はレシート、銀行・カードは明細の CSV）
  const sourceTab = tab === "calendar" || tab === "history" || tab === "csv";
  // 個人事業主モードは事業利用の口座・カードだけを選べる
  const scope = useActualsScope();
  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts", scope],
    enabled: sourceTab && source === "bank" && scope !== null,
    queryFn: async (): Promise<SourceAccount[]> =>
      (await (await fetch(withScope("/api/bank-accounts", scope!))).json()).data ?? [],
  });
  const { data: cardAccounts } = useQuery({
    queryKey: ["linked-accounts", scope],
    enabled: sourceTab && source === "card" && scope !== null,
    queryFn: async (): Promise<SourceAccount[]> =>
      (await (await fetch(withScope("/api/linked-accounts", scope!))).json()).data ?? [],
  });
  const historyCardId = cardAccounts?.find((a) => a.id === cardAccountId)?.id ?? null;
  const cardId = historyCardId ?? cardAccounts?.[0]?.id ?? null;
  const shownCardId = tab === "history" ? historyCardId : cardId;
  // 取り込みは口座を 1 つ選ぶ（「すべての銀行」は無い）。口座が 1 つだけなら、それを選んでおく
  const importBankId = bankAccountId ?? (bankAccounts?.length === 1 ? bankAccounts[0].id : null);
  const shownBankId = tab === "csv" ? importBankId : bankAccountId;

  // ── クエリ ────────────────────────────────────────────────────
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => (await (await fetch("/api/accounts")).json()).data,
  });

  return (
    <AppShell>
      <PageHeader title="実績管理" lead={textFor(ENTRY_HELP.page, sysMode)} showYear />

      {/* タブ（予算管理と同じ並び：一覧 → 確定 → … → 履歴） */}
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setHistoryStatus("all");
        }}
      />

      {/* 開いているタブで何ができるかの説明（実績の確定タブと設定タブは中に説明がある） */}
      {tab !== "confirm" && tab !== "settings" && (
        <SectionLead className="-mt-3 mb-4">
          {
            {
              manual: ENTRY_HELP.table,
              calendar: ENTRY_HELP.calendar,
              csv: source === "manual" ? ENTRY_HELP.importReceipt : ENTRY_HELP.importStatement,
              history: ENTRY_HELP.history,
            }[tab]
          }
        </SectionLead>
      )}
      {/* 取り込みと履歴は科目が学習ルールで付く・学習する場所なので、しくみを開いて読めるようにする */}
      {(tab === "csv" || tab === "history") && (
        <TermDetails
          terms={LEARNING_RULE_TERMS}
          summary="学習ルールのしくみ"
          className="-mt-2 mb-4"
        />
      )}

      {/* ── 出どころの選択（カレンダー・取り込み・履歴）。種別を選び、銀行・カードのときは口座も選ぶ ── */}
      {sourceTab && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SegmentedControl options={SOURCES} value={source} onChange={setSource} />
          {source === "bank" && (
            <select
              aria-label="銀行"
              className="input-field w-60"
              value={shownBankId ?? ""}
              onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{tab === "csv" ? "口座を選んでください" : "すべての銀行"}</option>
              {bankAccounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          {source === "card" &&
            (cardAccounts && cardAccounts.length === 0 ? (
              <span className="text-xs text-slate-500">
                カード・電子マネーが登録されていません（カード・電子マネー管理で登録します）
              </span>
            ) : (
              <select
                aria-label="カード・電子マネー"
                className="input-field w-60"
                value={shownCardId ?? ""}
                onChange={(e) => setCardAccountId(e.target.value ? Number(e.target.value) : null)}
              >
                {tab === "history" && <option value="">すべてのカード・電子マネー</option>}
                {cardAccounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ))}
        </div>
      )}

      {/* ── 銀行・カードのカレンダーと履歴（銀行管理・カード管理から移した部品）── */}
      {tab === "calendar" && source === "bank" && (
        <BankTransactionsCalendar accountId={bankAccountId} />
      )}
      {tab === "calendar" && source === "card" && cardId !== null && (
        <CardTransactionsPanel view="calendar" accountId={cardId} />
      )}
      {tab === "history" && source === "bank" && (
        <BankTransactionsPanel accountId={bankAccountId} initialStatus={historyStatus} />
      )}
      {tab === "history" && source === "card" && cardId !== null && (
        <CardTransactionsPanel
          view="list"
          accountId={historyCardId}
          initialStatus={historyStatus}
        />
      )}

      {/* ── 実績の確定タブ（② その月の実績。明細の最終日がそろったら確定する）── */}
      {tab === "confirm" && <ActualsConfirmPanel mode={sysMode} initialMonth={initial.month} />}

      {/* ── 一覧・カレンダー（現金）・取り込み・履歴（現金）の各タブ（components/entry/）── */}
      {tab === "manual" && <ActualsMatrixTab accounts={accounts} mode={sysMode} />}
      {tab === "calendar" && source === "manual" && (
        <CashCalendarTab accounts={accounts} mode={sysMode} />
      )}
      {tab === "csv" && (
        <ImportTab
          source={source}
          account={
            (source === "bank"
              ? bankAccounts?.find((a) => a.id === importBankId)
              : source === "card"
                ? cardAccounts?.find((a) => a.id === cardId)
                : undefined) ?? null
          }
          accounts={accounts}
          mode={sysMode}
          onShowUnassigned={(id) => {
            if (source === "bank") setBankAccountId(id);
            else setCardAccountId(id);
            setHistoryStatus("unassigned");
            setTab("history");
          }}
        />
      )}
      {tab === "history" && source === "manual" && (
        <CashHistoryTab accounts={accounts} mode={sysMode} />
      )}

      {/* ── 設定タブ（学習ルールの一覧と変更。予算管理の設定と同じ形）── */}
      {tab === "settings" && <LearningRulesPanel mode={sysMode} accounts={accounts} />}
    </AppShell>
  );
}
