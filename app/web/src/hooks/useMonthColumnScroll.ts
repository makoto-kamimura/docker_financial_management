"use client";

import { useCallback, useEffect, useRef } from "react";

// 科目×月テーブル（予算管理・実績管理の明細一覧）の横スクロール初期位置。
// 12か月ぶんの列は画面に収まらないため、既定では 1 月から表示され当月を見るのに
// 毎回スクロールが必要だった。当月の列が固定列「勘定科目」のすぐ右（＝内容の左端）に
// 来るよう初期位置を寄せ、同じ年の前月以前は左へスクロールすれば見えるようにする。
//
// targetMonth が null（当年以外を表示中など）のときは 1 月始まりに戻す。
// 位置合わせは targetMonth が変わったときの一度きりで、その後のユーザーの
// スクロール操作は奪わない。テーブルは読み込み完了後に現れるので、
// マウント時にも効くよう callback ref で装着時に適用する。
export function useMonthColumnScroll(targetMonth: number | null) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 直近で位置合わせした対象月。undefined = 未適用（null は「1月始まりに戻した」状態）
  const appliedFor = useRef<number | null | undefined>(undefined);

  const apply = useCallback(() => {
    const box = boxRef.current;
    if (!box || appliedFor.current === targetMonth) return;

    if (targetMonth === null) {
      box.scrollLeft = 0;
      appliedFor.current = null;
      return;
    }

    const cell = box.querySelector<HTMLElement>(`[data-month="${targetMonth}"]`);
    if (!cell) return; // 列がまだ描画されていない（次のレンダーで再試行される）
    const stickyWidth = box.querySelector<HTMLElement>("thead th")?.offsetWidth ?? 0;
    box.scrollLeft = Math.max(0, cell.offsetLeft - stickyWidth);
    appliedFor.current = targetMonth;
  }, [targetMonth]);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      boxRef.current = node;
      apply();
    },
    [apply],
  );

  // 年の切替などで対象月が変わったとき（テーブルは装着済み）に再適用する
  useEffect(apply, [apply]);

  return ref;
}
