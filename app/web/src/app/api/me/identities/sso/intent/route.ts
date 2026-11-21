import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { createIntent } from "@/lib/server/sso";

// POST /api/me/identities/sso/intent … 連携の開始に使う、使い捨ての intent（ブラウザの遷移では Bearer を送れないため）
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await createIntent(user);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ intent: r.intent });
}
