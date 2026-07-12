import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { parseYearMonth } from "@/lib/year-month";
import { computeDebtSchedule } from "@/lib/debt-schedule";

const CATEGORIES = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"] as const;

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const assets = await db.personalAsset.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  // 負債スケジュールが設定済みの資産には、経過月数から算出した現在残高を付与する
  const data = assets.map((a) => {
    const schedule =
      a.debtInitialAmount !== null && a.debtStartOn && a.debtPayoffDue
        ? computeDebtSchedule(Number(a.debtInitialAmount), a.debtStartOn, a.debtPayoffDue)
        : null;
    return {
      ...a,
      debtMonthly: schedule?.monthly ?? null,
      debtRemaining: schedule?.remaining ?? null,
      debtRemainingMonths: schedule ? schedule.totalMonths - schedule.paidMonths : null,
    };
  });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    name: string;
    category?: string;
    acquiredOn?: string;
    acquisitionCost?: number;
    currentValue: number;
    note?: string;
    linkedAccountId?: number;
    debtStartOn?: string; // 支払い開始年月（"YYYY-MM"）
    debtPayoffDue?: string; // 負債解消予定年月（"YYYY-MM"）
    debtInitialAmount?: number; // 当初負債額
  };

  if (!body.name || body.currentValue === undefined) {
    return NextResponse.json({ error: "name, currentValue are required" }, { status: 400 });
  }
  if (body.category && !CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: `invalid category: ${body.category}` }, { status: 400 });
  }
  if (body.linkedAccountId !== undefined) {
    const account = await db.account.findFirst({ where: { id: body.linkedAccountId, tenantId } });
    if (!account) {
      return NextResponse.json(
        { error: `invalid linkedAccountId: ${body.linkedAccountId}` },
        { status: 400 },
      );
    }
  }
  let debtStartOn: Date | null = null;
  if (body.debtStartOn) {
    const parsed = parseYearMonth(body.debtStartOn);
    if (!parsed) {
      return NextResponse.json(
        { error: `invalid debtStartOn: ${body.debtStartOn} (expected YYYY-MM)` },
        { status: 400 },
      );
    }
    debtStartOn = parsed;
  }
  let debtPayoffDue: Date | null = null;
  if (body.debtPayoffDue) {
    const parsed = parseYearMonth(body.debtPayoffDue);
    if (!parsed) {
      return NextResponse.json(
        { error: `invalid debtPayoffDue: ${body.debtPayoffDue} (expected YYYY-MM)` },
        { status: 400 },
      );
    }
    debtPayoffDue = parsed;
  }
  if (debtStartOn && debtPayoffDue && debtStartOn > debtPayoffDue) {
    return NextResponse.json(
      { error: "debtStartOn must be before or equal to debtPayoffDue" },
      { status: 400 },
    );
  }
  if (body.debtInitialAmount !== undefined && body.debtInitialAmount < 0) {
    return NextResponse.json(
      { error: `invalid debtInitialAmount: ${body.debtInitialAmount}` },
      { status: 400 },
    );
  }

  const asset = await db.personalAsset.create({
    data: {
      tenantId,
      name: body.name,
      category: (body.category as (typeof CATEGORIES)[number]) ?? "OTHER",
      acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
      acquisitionCost: body.acquisitionCost ?? null,
      currentValue: body.currentValue,
      note: body.note ?? null,
      linkedAccountId: body.linkedAccountId ?? null,
      debtStartOn,
      debtPayoffDue,
      debtInitialAmount: body.debtInitialAmount ?? null,
    },
  });
  return NextResponse.json({ data: asset }, { status: 201 });
}
