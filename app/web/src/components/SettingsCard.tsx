"use client";

// 設定の 1 項目を 1 枚のカードにまとめる部品（借入金管理・銀行管理の一覧のカードと同じ見出しの形）。
// 見出しと説明を左、操作のボタンを右に置き、説明が長くてもボタンは右端に残す。
// 保存の結果は SaveNotice で、カードの中のいちばん下にそろえて出す。

import type { ReactNode } from "react";
import { SectionLead } from "@/components/Explain";
import { Notice } from "@/components/ui";

export type SaveMessage = { ok: boolean; text: string } | null;

export function SettingsCard({
  title,
  lead,
  badge,
  actions,
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** 見出しの横に出す小さな状態（「有効」など） */
  badge?: ReactNode;
  /** 見出しの右に置く操作（保存など） */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2 className="section-title mb-0">{title}</h2>
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
