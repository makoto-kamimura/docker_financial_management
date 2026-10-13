// 勘定科目のモード別表示名解決（再設計仕様書 §6.6 / 再設計タスク.md F-4）。
//
// household → name（家庭科目名。既定）
// sole      → name（個人事業主モードは家庭モードと同じ科目名にそろえる。soleName は使わない）
// corporate → corporateName ?? name（法人モードの表示名。null は家庭名にフォールバック）
export type ViewMode = "household" | "sole" | "corporate";

export type DisplayNameAccount = {
  name: string;
  soleName?: string | null;
  corporateName?: string | null;
};

export function displayName(account: DisplayNameAccount, mode: ViewMode): string {
  if (mode === "corporate") return account.corporateName ?? account.name;
  return account.name;
}
