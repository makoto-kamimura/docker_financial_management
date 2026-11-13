import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import { readUploadedFile } from "@/lib/server/upload";
import { createReceiptDraft, listReceiptDrafts } from "@/lib/ledger/receipt-drafts";

// 仮の明細（レシート・領収書を撮ってすぐ保存し、読み取りはあとで進める。lib/ledger/receipt-drafts.ts）。
// 仮は集計に入らない。確かめて登録する（POST /api/actuals の draftId）と現金の明細になる。

// GET /api/actuals/drafts[?year=&month=] … 仮の一覧（年月を渡すと、撮ったときに選んでいた日がその月のもの）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ db, query }) => {
    const month =
      query.year !== undefined && query.month !== undefined
        ? { year: query.year, month: query.month }
        : undefined;
    return NextResponse.json({ data: await listReceiptDrafts(db, month) });
  },
});

// POST /api/actuals/drafts … 写真（multipart の file）と日付（date、YYYY-MM-DD）で仮を作る。
//   すぐ応答し（status: READING）、読み取りは応答のあとに進める。読み取りの回数の上限は、読み取るときに数える
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, audit }) => {
    const upload = await readUploadedFile(req, { imagesOnly: true });
    const rawDate = upload.form?.get("date");
    const date =
      typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw badRequest("日付（date、YYYY-MM-DD）を指定してください");
    }
    const draft = await createReceiptDraft(db, user, upload, new Date(`${date}T00:00:00Z`));
    await audit("create_receipt_draft", `receipt_draft:${draft.id}`);
    return NextResponse.json({ data: draft }, { status: 201 });
  },
});
