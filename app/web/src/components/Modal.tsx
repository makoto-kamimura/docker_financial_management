"use client";

// 画面の上に重ねるダイアログの枠（暗い背景・白いパネル・大きさ・Esc で閉じる）。
// 中身（見出し・入力欄・保存とキャンセルのボタン）は呼び出し側が置く。
// 背景を押しても閉じない（入力中の内容を誤って失わないため）。

import { useEffect, type ReactNode } from "react";

const SIZE = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-2xl",
} as const;

export function Modal({
  size = "md",
  onClose,
  labelledBy,
  children,
}: {
  /** パネルの幅。sm: 確認、md: 入力フォーム、lg: 項目の多いフォーム、xl: 表や一覧 */
  size?: keyof typeof SIZE;
  /** 渡すと Esc で閉じる */
  onClose?: () => void;
  /** 見出しの id（読み上げ用） */
  labelledBy?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`bg-white rounded-2xl shadow-xl p-6 w-full ${SIZE[size]} my-auto`}
      >
        {children}
      </div>
    </div>
  );
}
