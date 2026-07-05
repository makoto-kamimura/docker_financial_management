import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { getSessionDetail } from "@/lib/account-conversion";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId, id: userId } = auth.user;
  const detail = await getSessionDetail(Number(id), tenantId, userId);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: detail });
}
