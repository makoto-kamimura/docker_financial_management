import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/server/auth";
import { setSsoOnly } from "@/lib/server/sso";

// PUT /api/me/sso-only … 「SSO だけでログインする」の切り替え。{ enabled: boolean }。
// オンにできるのは、連携済みで、いま SSO でログインしている人だけ
export async function PUT(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const r = await setSsoOnly(s.user, s.loginMethod, parsed.data.enabled, req);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ sso_only: r.sso_only });
}
