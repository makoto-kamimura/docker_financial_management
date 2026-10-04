import { Info } from "lucide-react";
import type { TermHelp } from "@/lib/help-texts";

// 画面に常に出す説明の部品。文言は lib/help-texts.ts にまとめている。
// ホバーでしか開かない吹き出しはタッチ端末で読めないため、説明は見出しの下に出す。

/** ページ見出し（h1）の下の説明 */
export function PageLead({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">{children}</p>;
}

/** カードの見出し（section-title）の下の説明 */
export function SectionLead({
  children,
  className = "mb-3",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p className={`text-xs text-slate-500 leading-relaxed max-w-3xl ${className}`}>{children}</p>
  );
}

/** 大事な考え方（自動でこうなる・ここには含めない など）を示す注意書き */
export function InfoNote({
  title,
  children,
  className = "mb-4",
}: {
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs leading-relaxed text-slate-600 ${className}`}
    >
      <Info className="w-4 h-4 mt-px shrink-0 text-indigo-500" aria-hidden="true" />
      <div>
        {title && <p className="font-semibold text-slate-700">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** 表の列や印の説明。開閉式にして、表の上を説明で埋めないようにする */
export function TermDetails({
  terms,
  summary = "各列の説明",
  className = "mb-4",
}: {
  terms: TermHelp[];
  summary?: string;
  className?: string;
}) {
  return (
    <details className={`text-xs text-slate-600 ${className}`}>
      <summary className="cursor-pointer text-indigo-600 hover:underline w-fit">{summary}</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr] max-w-3xl">
        {terms.map((t) => (
          <div key={t.term} className="contents">
            <dt className="font-semibold text-slate-700 whitespace-nowrap">{t.term}</dt>
            <dd className="leading-relaxed">{t.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
