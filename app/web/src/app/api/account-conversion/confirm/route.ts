import { NextResponse } from "next/server";
import { z } from "zod";
import type { AccountConversionMode, AccountMappingMatchType } from "@prisma/client";
import { withApi } from "@/lib/api-handler";
import { forbidden } from "@/lib/api-error";
import { saveManualMappingRule } from "@/lib/account-conversion";

const MODES = ["HOME", "CORPORATE"] as const;
const MATCH_TYPES = ["TABLE", "KEYWORD", "FUZZY", "AI_FREE", "AI_PAID", "MANUAL"] as const;

const ConfirmSchema = z
  .object({
    fromMode: z.enum(MODES),
    toMode: z.enum(MODES),
    mappings: z
      .array(
        z.object({
          homeAccountId: z.number().int().positive(),
          corporateAccountId: z.number().int().positive().nullable(),
          matchType: z.enum(MATCH_TYPES),
          confidenceScore: z.number().nullable(),
          isConvertible: z.boolean(),
          isManuallyOverridden: z.boolean(),
        }),
      )
      .min(1),
  })
  .refine((d) => d.fromMode !== d.toMode, {
    message: "fromMode/toMode must differ and be HOME or CORPORATE",
  });

// POST /api/account-conversion/confirm … 変換確認画面での確定操作。
// 変換セッション・ログを保存し、手動変更したマッピングは自分専用ルールとして学習・保存する。
export const POST = withApi({
  role: "editor",
  schema: ConfirmSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId, id: userId } = user;

    const accountIds = [
      ...new Set(
        body.mappings
          .flatMap((m) => [m.homeAccountId, m.corporateAccountId])
          .filter((x): x is number => x != null),
      ),
    ];
    const accounts = await db.account.findMany({ where: { id: { in: accountIds }, tenantId } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    if (accountIds.some((id) => !byId.has(id))) {
      throw forbidden("one or more accounts do not belong to this tenant");
    }

    const session = await db.accountConversionSession.create({
      data: {
        userId,
        fromMode: body.fromMode as AccountConversionMode,
        toMode: body.toMode as AccountConversionMode,
        status: "COMPLETED",
      },
    });

    await db.accountConversionLog.createMany({
      data: body.mappings.map((m) => ({
        sessionId: session.id,
        homeAccountId: m.homeAccountId,
        corporateAccountId: m.corporateAccountId,
        matchType: m.matchType as AccountMappingMatchType,
        confidenceScore: m.confidenceScore,
        isConvertible: m.isConvertible,
        isManuallyOverridden: m.isManuallyOverridden,
      })),
    });

    // ユーザーが手動で変更したマッピングは、次回以降の自動変換のために自分専用ルールとして保存する
    const overridden = body.mappings.filter(
      (m) => m.isManuallyOverridden && m.corporateAccountId != null,
    );
    for (const m of overridden) {
      const home = byId.get(m.homeAccountId);
      const corp = byId.get(m.corporateAccountId!);
      if (!home || !corp) continue;
      await saveManualMappingRule(userId, home.code, corp.code);
    }

    return NextResponse.json({ data: { sessionId: session.id } }, { status: 201 });
  },
});
