import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/server/auth";
import { exchangeResult } from "@/lib/server/sso";

const Schema = z.object({ code: z.string().max(200), code_verifier: z.string().max(200) });

// POST /api/auth/sso/exchange … 結果コードと code_verifier の交換（モバイル用。Web は /auth/sso/complete で直接行う）。
// ログインならセッション（パスワードのログインと同じ { data: { …, sessionId } }）、連携なら Bearer の本人に登録する
export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const r = await exchangeResult(parsed.data.code, parsed.data.code_verifier, getCurrentUser, req);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  if (r.mode === "link") return NextResponse.json({ mode: "link", email: r.email });
  return NextResponse.json({ mode: "login", data: { ...r.user, sessionId: r.sessionId } });
}
