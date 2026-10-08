"use client";

// 明細の登録フォーム（銀行・カードのカレンダー）の科目の欄。
// 選んだ科目を付けて登録すると、その明細がそのまま実績になる。「自動」のままなら、
// サーバーが学習ルール（摘要のキーワード）で科目を決め、当たらなければ未割り当てになる。

import { useQuery } from "@tanstack/react-query";
import { displayName, type ViewMode } from "@/lib/shared/display-name";

type CategoryAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

/** 出金（支出）・入金（収入）で選べる科目の区分 */
const CATEGORIES = {
  expense: ["EXPENSE", "COGS"],
  income: ["REVENUE"],
} as const;

/** フォームの値（"" = 自動）を API の categoryAccountId（省略 = 学習ルール）にする */
export const categoryPayload = (value: string) =>
  value === "" ? {} : { categoryAccountId: Number(value) };

export function EntryCategoryField({
  value,
  onChange,
  direction,
  mode = "household",
}: {
  value: string;
  onChange: (value: string) => void;
  direction: "income" | "expense";
  mode?: ViewMode;
}) {
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });
  const options = (accounts ?? []).filter((a) =>
    (CATEGORIES[direction] as readonly string[]).includes(a.category),
  );
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-slate-500">科目</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field text-xs"
      >
        <option value="">自動（学習した科目。無ければ未割り当て）</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {displayName(a, mode)}
          </option>
        ))}
      </select>
    </div>
  );
}
