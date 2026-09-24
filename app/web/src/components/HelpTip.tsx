"use client";

import { useEffect, useRef, useState } from "react";

// ラベルの横に置く「?」マーク。クリックで用語の説明を吹き出し表示する。
// 説明が長くなりがちな金融用語（変動金利の 5 年ルール等）を、画面を離れずに読めるようにする。
export function HelpTip({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // 吹き出しの外側クリック・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={ref} className={`relative inline-block align-middle ${className}`}>
      <button
        type="button"
        aria-label={`${title}の説明`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        ?
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-50 block w-72 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg">
          <span className="mb-1 block text-xs font-bold text-slate-800">{title}</span>
          <span className="block space-y-1.5 text-[11px] leading-relaxed text-slate-600">
            {children}
          </span>
        </span>
      )}
    </span>
  );
}

// 変動金利の返済額がどう決まるかの説明。金利改定まわりの各所から参照する
export function VariableRateHelp({ className }: { className?: string }) {
  return (
    <HelpTip title="金利が変わると返済額はどうなる？" className={className}>
      <span className="block">
        <b className="text-slate-700">5 年ルール</b>
        （多くの銀行が採用）… 金利が変わっても
        <b>毎月の返済額は 5 年間変わりません</b>
        。変わるのは元本と利息の内訳だけで、金利が上がると元本の減りが遅くなります。返済額の見直しは
        5 年ごとです。
      </span>
      <span className="block">
        <b className="text-slate-700">125% ルール</b>… 5 年ごとの見直しでも、新しい返済額は 従前の
        1.25 倍が上限です。上限に当たって利息を払いきれない分は「未払利息」として
        繰り延べられ、最終回に請求されることがあります。
      </span>
      <span className="block">
        <b className="text-slate-700">都度見直し型</b>
        （ソニー銀行・PayPay 銀行・SBI 新生銀行など）… これらのルールが無く、
        <b>金利改定のたびに返済額が再計算されます</b>。
      </span>
      <span className="block border-t border-slate-100 pt-1.5 text-slate-500">
        どちらの方式かで正しい返済額が変わるため、このシステムでは
        <b className="text-slate-700">金融機関から通知された実際の金額を入力</b>
        してもらい、それを正としています。表示される計算値はあくまで参考です。
      </span>
    </HelpTip>
  );
}
