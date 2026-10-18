import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import type { TenantDb } from "@/lib/server/tenant-db";
import { StatementMappingSchema, type StatementMapping } from "@/lib/shared/statement-formats";

// 口座・カードごとに覚える、明細の CSV の読み方（lib/shared/statement-formats.ts の StatementMapping）。
// 実績管理の取り込みで、自動で読めない・読み違えた CSV の列の役割を直し、次からも同じ見出しの CSV に使う。
//   GET /api/imports/mapping?target=bank|card&accountId= … { mapping }（覚えていなければ null）
//   PUT /api/imports/mapping { target, accountId, mapping } … 覚える。mapping が null なら忘れる

const Target = z.object({
  target: z.enum(["bank", "card"]),
  accountId: z.coerce.number().int().positive(),
});

/** 口座・カードの今の読み方。無い・形が壊れていれば null */
async function readMapping(
  db: TenantDb,
  tenantId: number,
  { target, accountId }: z.infer<typeof Target>,
): Promise<{ found: boolean; mapping: StatementMapping | null }> {
  const where = { id: accountId, tenantId };
  const select = { csvMapping: true } as const;
  const row =
    target === "bank"
      ? await db.bankAccount.findFirst({ where, select })
      : await db.linkedAccount.findFirst({ where, select });
  if (!row) return { found: false, mapping: null };
  const parsed = StatementMappingSchema.safeParse(row.csvMapping);
  return { found: true, mapping: parsed.success ? parsed.data : null };
}

export const GET = withApi({
  role: "viewer",
  querySchema: Target,
  handler: async ({ db, user, query }) => {
    const { found, mapping } = await readMapping(db, user.tenantId, query);
    if (!found) throw notFound("口座が見つかりません");
    return NextResponse.json({ mapping });
  },
});

export const PUT = withApi({
  role: "editor",
  schema: Target.extend({ mapping: StatementMappingSchema.nullable() }),
  handler: async ({ db, user, body, audit }) => {
    const { found } = await readMapping(db, user.tenantId, body);
    if (!found) throw notFound("口座が見つかりません");
    const data = { csvMapping: body.mapping ?? Prisma.DbNull };
    if (body.target === "bank") {
      await db.bankAccount.update({ where: { id: body.accountId }, data });
    } else {
      await db.linkedAccount.update({ where: { id: body.accountId }, data });
    }
    await audit(
      body.mapping ? "update_csv_mapping" : "clear_csv_mapping",
      `${body.target}:${body.accountId}`,
    );
    return NextResponse.json({ mapping: body.mapping });
  },
});
