import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const ProfileSchema = z.object({
  tradeName: z.string().optional(),
  ownerName: z.string().optional(),
  openedOn: z.string().nullable().optional(),
  blueReturn: z.boolean().optional(),
  invoiceNumber: z.string().nullable().optional(),
  taxationType: z.string().optional(),
});

// GET /api/business-profile … 事業者情報の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const profile = await db.businessProfile.findUnique({
      where: { tenantId: user.tenantId },
    });
    return NextResponse.json({ data: profile });
  },
});

// PUT /api/business-profile … 事業者情報の登録・更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: ProfileSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;
    const data = {
      tradeName: body.tradeName ?? "",
      ownerName: body.ownerName ?? "",
      openedOn: body.openedOn ? new Date(body.openedOn) : null,
      blueReturn: body.blueReturn ?? false,
      invoiceNumber: body.invoiceNumber ?? null,
      taxationType: body.taxationType ?? "exempt",
    };

    const profile = await db.businessProfile.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return NextResponse.json({ data: profile });
  },
});
