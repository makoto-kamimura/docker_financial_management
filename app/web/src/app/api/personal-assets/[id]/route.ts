import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { parseYearMonth } from "@/lib/year-month";

const CATEGORIES = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"] as const;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.personalAsset.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as Partial<{
    name: string;
    category: string;
    acquiredOn: string | null;
    acquisitionCost: number | null;
    currentValue: number;
    note: string | null;
    linkedAccountId: number | null;
    debtStartOn: string | null; // 支払い開始年月（"YYYY-MM"）
    debtPayoffDue: string | null; // 負債解消予定年月（"YYYY-MM"）
    debtInitialAmount: number | null; // 当初負債額
  }>;
  if (body.category && !CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: `invalid category: ${body.category}` }, { status: 400 });
  }
  if (body.linkedAccountId !== undefined && body.linkedAccountId !== null) {
    const account = await db.account.findFirst({ where: { id: body.linkedAccountId, tenantId } });
    if (!account) {
      return NextResponse.json(
        { error: `invalid linkedAccountId: ${body.linkedAccountId}` },
        { status: 400 },
      );
    }
  }
  let debtStartOn: Date | null | undefined = undefined;
  if (body.debtStartOn !== undefined) {
    if (body.debtStartOn === null) {
      debtStartOn = null;
    } else {
      const parsed = parseYearMonth(body.debtStartOn);
      if (!parsed) {
        return NextResponse.json(
          { error: `invalid debtStartOn: ${body.debtStartOn} (expected YYYY-MM)` },
          { status: 400 },
        );
      }
      debtStartOn = parsed;
    }
  }
  let debtPayoffDue: Date | null | undefined = undefined;
  if (body.debtPayoffDue !== undefined) {
    if (body.debtPayoffDue === null) {
      debtPayoffDue = null;
    } else {
      const parsed = parseYearMonth(body.debtPayoffDue);
      if (!parsed) {
        return NextResponse.json(
          { error: `invalid debtPayoffDue: ${body.debtPayoffDue} (expected YYYY-MM)` },
          { status: 400 },
        );
      }
      debtPayoffDue = parsed;
    }
  }
  // 更新後の開始・解消予定の組み合わせで前後関係を検証する
  const nextStartOn = debtStartOn !== undefined ? debtStartOn : existing.debtStartOn;
  const nextPayoffDue = debtPayoffDue !== undefined ? debtPayoffDue : existing.debtPayoffDue;
  if (nextStartOn && nextPayoffDue && nextStartOn > nextPayoffDue) {
    return NextResponse.json(
      { error: "debtStartOn must be before or equal to debtPayoffDue" },
      { status: 400 },
    );
  }
  if (
    body.debtInitialAmount !== undefined &&
    body.debtInitialAmount !== null &&
    body.debtInitialAmount < 0
  ) {
    return NextResponse.json(
      { error: `invalid debtInitialAmount: ${body.debtInitialAmount}` },
      { status: 400 },
    );
  }

  const asset = await db.personalAsset.update({
    where: { id: Number(id) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.category !== undefined && {
        category: body.category as (typeof CATEGORIES)[number],
      }),
      ...(body.acquiredOn !== undefined && {
        acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
      }),
      ...(body.acquisitionCost !== undefined && { acquisitionCost: body.acquisitionCost }),
      ...(body.currentValue !== undefined && { currentValue: body.currentValue }),
      ...(body.note !== undefined && { note: body.note }),
      ...(body.linkedAccountId !== undefined && { linkedAccountId: body.linkedAccountId }),
      ...(debtStartOn !== undefined && { debtStartOn }),
      ...(debtPayoffDue !== undefined && { debtPayoffDue }),
      ...(body.debtInitialAmount !== undefined && { debtInitialAmount: body.debtInitialAmount }),
    },
  });
  return NextResponse.json({ data: asset });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.personalAsset.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.personalAsset.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
