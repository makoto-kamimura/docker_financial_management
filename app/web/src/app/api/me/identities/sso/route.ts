import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { unlink } from "@/lib/server/sso";

// DELETE /api/me/identities/sso … SSO の連携の解除（「SSO だけ」も外す）
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await unlink(user, req));
}
