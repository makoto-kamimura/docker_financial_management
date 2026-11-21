import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server/auth";
import { identities } from "@/lib/server/sso";

// GET /api/me/identities … 自分の SSO の連携と「SSO だけ」の状態、いまのログイン方法
export async function GET() {
  const s = await getCurrentSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await identities(s.user, s.loginMethod));
}
