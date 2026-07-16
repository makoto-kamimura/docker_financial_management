// 勘定科目のモード別表示名解決（再設計仕様書 §6.6 / 再設計タスク.md F-4）。
//
// household → name（家庭科目名。既定）
// sole      → soleName ?? name（個人事業主モードの表示名。null は家庭名にフォールバック）
// corporate → corporateName ?? name（法人モードの表示名。null は家庭名にフォールバック）
export type ViewMode = "household" | "sole" | "corporate";

export type DisplayNameAccount = {
  name: string;
  soleName?: string | null;
  corporateName?: string | null;
};

export function displayName(account: DisplayNameAccount, mode: ViewMode): string {
  if (mode === "sole") return account.soleName ?? account.name;
  if (mode === "corporate") return account.corporateName ?? account.name;
  return account.name;
}
