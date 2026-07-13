import type { ViewMode } from "./api";

export type DisplayNameAccount = { name: string; soleName?: string | null; corporateName?: string | null };

export function displayName(account: DisplayNameAccount, mode: ViewMode): string {
  if (mode === "sole") return account.soleName ?? account.name;
  if (mode === "corporate") return account.corporateName ?? account.name;
  return account.name;
}
