// 控除・確定申告で使う書類のファイル。証明書（源泉徴収票・控除証明書など）の画像・PDF（TaxDocument）と、
// セルフメディケーション税制の対象の市販薬を含むレシート（証憑 Receipt の selfMedicationAmount）。
import { z } from "zod";
import { badRequest } from "@/lib/server/api-error";
import { resolveReceiptFileUrl } from "@/lib/server/upload";
import type { TenantDbClient } from "@/lib/server/tenant-db";

const yen = z.number().int().min(0).max(100_000_000);

export const SelfMedicationItemsSchema = z
  .array(z.object({ name: z.string().trim().min(1).max(100), amount: yen }))
  .max(100);

export type SelfMedicationItem = z.infer<typeof SelfMedicationItemsSchema>[number];

/** 証憑に付けるセルフメディケーション税制の対象の額と品目。amount が null なら対象外にする */
export const SelfMedicationSchema = z.object({
  amount: yen.nullable(),
  items: SelfMedicationItemsSchema.default([]),
});

/**
 * 証憑のアップロード（multipart）の任意の項目 selfMedicationAmount・selfMedicationItems（JSON）を読む。
 * どちらも無ければ null（対象外）。形が合わなければ 400
 */
export function parseSelfMedicationFields(
  form: FormData,
): { amount: number; items: SelfMedicationItem[] } | null {
  const rawAmount = form.get("selfMedicationAmount");
  if (rawAmount === null || rawAmount === "") return null;
  const amount = yen.safeParse(Number(rawAmount));
  if (!amount.success) throw badRequest("セルフメディケーションの額が正しくありません");
  const rawItems = form.get("selfMedicationItems");
  let items: unknown = [];
  if (typeof rawItems === "string" && rawItems !== "") {
    try {
      items = JSON.parse(rawItems);
    } catch {
      throw badRequest("セルフメディケーションの品目が正しくありません");
    }
  }
  const parsed = SelfMedicationItemsSchema.safeParse(items);
  if (!parsed.success) throw badRequest("セルフメディケーションの品目が正しくありません");
  return { amount: amount.data, items: parsed.data };
}

export const TAX_DOCUMENT_SELECT = {
  id: true,
  taxYear: true,
  docId: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  uploadedAt: true,
} as const;

export function taxDocumentFileUrl(id: number) {
  return `/api/tax-return/documents/${id}/file`;
}

/** その年の証明書の一覧（書類ごと・アップロードの順） */
export async function loadTaxDocuments(db: TenantDbClient, year: number) {
  const rows = await db.taxDocument.findMany({
    where: { taxYear: year },
    select: TAX_DOCUMENT_SELECT,
    orderBy: [{ docId: "asc" }, { uploadedAt: "asc" }],
  });
  return rows.map((r) => ({ ...r, fileUrl: taxDocumentFileUrl(r.id) }));
}

export type SelfMedicationReceipt = {
  id: number;
  entryId: number;
  date: string | null;
  merchant: string;
  amount: number;
  items: SelfMedicationItem[];
  fileName: string;
  fileType: string;
  fileUrl: string;
};

/** その年の明細に付いた、セルフメディケーション税制の対象のレシート（日付の順） */
export async function loadSelfMedicationReceipts(
  db: TenantDbClient,
  tenantId: number,
  year: number,
): Promise<SelfMedicationReceipt[]> {
  const rows = await db.receipt.findMany({
    where: {
      selfMedicationAmount: { not: null },
      financialRecord: { tenantId, period: { fiscalYear: year } },
    },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileUrl: true,
      savedName: true,
      selfMedicationAmount: true,
      selfMedicationItems: true,
      financialRecord: { select: { id: true, date: true, description: true } },
    },
  });
  return rows
    .map((r) => {
      const items = SelfMedicationItemsSchema.safeParse(r.selfMedicationItems ?? []);
      return {
        id: r.id,
        entryId: r.financialRecord!.id,
        date: r.financialRecord!.date?.toISOString().slice(0, 10) ?? null,
        merchant: r.financialRecord!.description ?? "",
        amount: Math.round(Number(r.selfMedicationAmount)),
        items: items.success ? items.data : [],
        fileName: r.fileName,
        fileType: r.fileType,
        fileUrl: resolveReceiptFileUrl(r),
      };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id - b.id);
}
