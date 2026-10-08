"use client";

// 画面の 1 つのまとまりを 1 枚のカードにする部品（サマリ・推移のグラフ・設定の各項目など）。
// 見出し・説明を左、操作（「〜で見る」のリンク・保存など）を右に置き、説明が長くても操作は右端に残す。
// 見出しの横には小さな状態（「有効」・増減の印など）を出せる。読み上げ用に見出しとカードを結び付ける。
// 保存の結果は SaveNotice で、カードの中のいちばん下にそろえて出す。

import { useId, type ReactNode } from "react";
import { SectionLead } from "@/components/Explain";
import { Notice } from "@/components/ui";

export type SaveMessage = { ok: boolean; text: string } | null;

export function SectionCard({
  title,
  lead,
  badge,
  actions,
  children,
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** 見出しの横に出す小さな状態（「有効」・増減の印など） */
  badge?: ReactNode;
  /** 見出しの右に置く操作（リンク・保存など） */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="card mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2 id={titleId} className="section-title mb-0">
              {title}
            </h2>
            {badge}
          </div>
          {lead && <SectionLead className="mb-0">{lead}</SectionLead>}
        </div>
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** 保存の結果（成功は緑、失敗は赤）。msg が null のときは何も出さない */
export function SaveNotice({ msg, className = "mt-4" }: { msg: SaveMessage; className?: string }) {
  if (!msg) return null;
  return (
    <Notice tone={msg.ok ? "success" : "error"} className={className}>
      {msg.text}
    </Notice>
  );
}
