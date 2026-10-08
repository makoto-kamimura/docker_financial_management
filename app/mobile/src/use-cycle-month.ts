// 予実差確認・予算の確定・実績の確定の対象月（web 版 lib/client/use-cycle-month.ts と同じ決め方）。
// 年は画面上部の対象年度、月は画面で選ぶ。
//   - 他の画面から月を指定して開いたら、その年を対象年度に反映して、その月を選ぶ
//   - それ以外は、最後に実績を確定した月から既定の月を決める（shared/cycle-month.ts）
import { useEffect, useState } from "react";
import { fetchLastActualsConfirmed } from "./api";
import { getFiscalYear, setFiscalYear, useFiscalYear } from "./fiscal-year";
import { defaultCycleKey, monthInYear, type CycleMonthKind } from "./shared/cycle-month";

export function useCycleMonth(kind: CycleMonthKind, initialMonth?: string) {
  const year = useFiscalYear();
  const [month, setMonth] = useState<number | null>(() =>
    initialMonth ? Number(initialMonth.slice(5)) : null,
  );

  useEffect(() => {
    if (initialMonth) setFiscalYear(Number(initialMonth.slice(0, 4)));
  }, [initialMonth]);

  useEffect(() => {
    if (month !== null || initialMonth) return;
    let cancelled = false;
    fetchLastActualsConfirmed()
      .catch(() => null)
      .then((latest) => {
        if (!cancelled) setMonth(monthInYear(defaultCycleKey(latest, kind), getFiscalYear()));
      });
    return () => {
      cancelled = true;
    };
  }, [month, initialMonth, kind]);

  return { year, month, setMonth };
}
