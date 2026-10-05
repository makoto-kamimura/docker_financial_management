"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { defaultCycleKey, monthInYear, type CycleMonthKind } from "@/lib/cycle-month";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";

// 予実差確認・予算の確定・実績の確定の対象月。年は左のメニューの対象年度、月は画面で選ぶ。
//   - URL の ?month=YYYY-MM で開いたら、その年を左のメニューに反映して、その月を選ぶ
//   - それ以外は、最後に実績を確定した月から既定の月を決める（lib/cycle-month.ts）
export function useCycleMonth(kind: CycleMonthKind, initialMonth?: string) {
  const year = useFiscalYear();
  const [month, setMonth] = useState<number | null>(() =>
    initialMonth ? Number(initialMonth.slice(5)) : null,
  );

  useEffect(() => {
    if (initialMonth) setFiscalYear(Number(initialMonth.slice(0, 4)));
  }, [initialMonth]);

  const { data: latest } = useQuery({
    queryKey: ["cycle-latest"],
    queryFn: async (): Promise<string | null> =>
      (await (await fetch("/api/cycle-status/latest")).json()).data?.lastActualsConfirmed ?? null,
    enabled: !initialMonth,
  });

  useEffect(() => {
    if (month !== null || initialMonth || latest === undefined) return;
    setMonth(monthInYear(defaultCycleKey(latest, kind), year));
  }, [month, initialMonth, latest, kind, year]);

  return { year, month, setMonth };
}
