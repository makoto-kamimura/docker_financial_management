import { NextRequest, NextResponse } from "next/server";
import type { AccountConversionMode, AccountMappingMatchType } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

type MappingInput = {
  homeAccountId: number;
  corporateAccountId: number | null;
  matchType: AccountMappingMatchType;
  confidenceScore: number | null;
  isConvertible: boolean;
  isManuallyOverridden: boolean;
};

const MODES: AccountConversionMode[] = ["HOME", "CORPORATE"];

// 変換確認画面での確定操作。変換セッション・ログを保存し、
// ユーザーが手動で変更したマッピングは自分専用ルールとして学習・保存する。
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId, id: userId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    fromMode: AccountConversionMode;
    toMode: AccountConversionMode;
    mappings: MappingInput[];
  };

  if (!MODES.includes(body.fromMode) || !MODES.includes(body.toMode) || body.fromMode === body.toMode) {
    return NextResponse.json({ error: "fromMode/toMode must differ and be HOME or CORPORATE" }, { status: 400 });
  }
  if (!Array.isArray(body.mappings) || body.mappings.length === 0) {
    return NextResponse.json({ error: "mappings is required" }, { status: 400 });
  }

  const accountIds = [
    ...new Set(
      body.mappings.flatMap((m) => [m.homeAccountId, m.corporateAccountId]).filter((x): x is number => x != null),
    ),
  ];
  const accounts = await db.account.findMany({ where: { id: { in: accountIds }, tenantId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (accountIds.some((id) => !byId.has(id))) {
    return NextResponse.json({ error: "one or more accounts do not belong to this tenant" }, { status: 403 });
  }

  const session = await db.accountConversionSession.create({
    data: { userId, fromMode: body.fromMode, toMode: body.toMode, status: "COMPLETED" },
  });

  await db.accountConversionLog.createMany({
    data: body.mappings.map((m) => ({
      sessionId: session.id,
      homeAccountId: m.homeAccountId,
      corporateAccountId: m.corporateAccountId,
      matchType: m.matchType,
      confidenceScore: m.confidenceScore,
      isConvertible: m.isConvertible,
      isManuallyOverridden: m.isManuallyOverridden,
    })),
  });

  // ユーザーが手動で変更したマッピングは、次回以降の自動変換のために自分専用ルールとして保存する
  const overridden = body.mappings.filter((m) => m.isManuallyOverridden && m.corporateAccountId != null);
  for (const m of overridden) {
    const home = byId.get(m.homeAccountId);
    const corp = byId.get(m.corporateAccountId!);
    if (!home || !corp) continue;
    await db.accountMappingRule.upsert({
      where: { homeCode_userId: { homeCode: home.code, userId } },
      update: { corporateCode: corp.code, isConvertible: true, matchType: "MANUAL", confidenceScore: 1.0 },
      create: {
        homeCode: home.code,
        userId,
        corporateCode: corp.code,
        isConvertible: true,
        matchType: "MANUAL",
        confidenceScore: 1.0,
      },
    });
  }

  return NextResponse.json({ data: { sessionId: session.id } }, { status: 201 });
}
