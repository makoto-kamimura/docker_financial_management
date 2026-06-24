import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export type Role = "admin" | "editor" | "accountant" | "viewer";

// ロールの権限階層（上位は下位を包含）
// accountant = 閲覧・仕訳確認・申告書出力が可能、マスタ編集・ユーザー管理は不可
const RANK: Record<Role, number> = { viewer: 1, accountant: 2, editor: 3, admin: 4 };

type AuthResult =
  | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; error?: never }
  | { user?: never; error: NextResponse };

// 最低限必要なロールを満たすログインユーザーを取得する。
// 未ログインなら 401、権限不足なら 403 を返す。
export async function requireRole(min: Role): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = (user.role as Role) ?? "viewer";
  if ((RANK[role] ?? 0) < RANK[min]) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}
