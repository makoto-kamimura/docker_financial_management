// 仮の明細（レシート・領収書を撮ってすぐ保存し、読み取りはあとで進める現金の明細の下書き）。
//
// - 撮ったら写真を証憑の置き場所に保存し、仮（READING）を作って、すぐ応答する
// - 読み取りは応答のあとに進め（runInBackground）、終われば読み取った店名・金額などを仮に入れる（READ）。
//   読み取れなければ理由を残す（FAILED）。同時に読むのは 1 枚ずつ（OCR サービスを混ませない）
// - 利用者が確かめて登録すると（POST /api/actuals の draftId）、現金の明細になり、写真は証憑に付け替えて仮は消える
// - 仮は集計に入らない。実績の確定は、その月の仮が残っていると受け付けない（actuals-coverage.ts）
import type { Prisma } from "@prisma/client";
import { tenantDb, type TenantDbClient } from "@/lib/server/tenant-db";
import { ApiError, conflict, notFound } from "@/lib/server/api-error";
import { runInBackground } from "@/lib/server/background";
import { uploadStorage } from "@/lib/server/storage";
import {
  removeTenantUpload,
  resolveReceiptFileUrl,
  storeTenantUpload,
  type UploadedFile,
} from "@/lib/server/upload";
import { scanReceipt, type ScanOutcome } from "@/lib/ledger/receipt-scan/scan";
import type { ClaudeImageType } from "@/lib/ledger/receipt-scan/claude";
import type { QualityWarning, ReceiptDraft } from "@/lib/ledger/receipt-scan/types";
import type { SelfMedicationItem } from "@/lib/tax/documents";

export type ReceiptDraftStatus = "READING" | "READ" | "FAILED";

/** 画面に返す仮の明細 */
export type ReceiptDraftView = {
  id: number;
  /** 撮ったときに選んでいた日（YYYY-MM-DD） */
  date: string;
  status: ReceiptDraftStatus;
  /** 読み取った結果（READ のときだけ）。登録のフォームに入れる */
  result: {
    draft: ReceiptDraft;
    suggestedAccount: ScanOutcome["suggestedAccount"];
    warnings: QualityWarning[];
  } | null;
  /** 読み取れなかった理由（FAILED のときだけ） */
  error: string | null;
  photo: { id: number; fileName: string; fileUrl: string } | null;
  createdAt: string;
};

// 読み取り中のまま、これより長く更新が無ければ止まったとみなす（読み取りの途中で web が再起動したときなど）
export const STALE_READING_MS = 3 * 60_000;
const STALLED_MESSAGE = "読み取りが止まりました。もう一度読み取るか、手で入力してください";

const DRAFT_INCLUDE = {
  receipts: {
    select: { id: true, fileName: true, savedName: true, fileUrl: true, mimeType: true },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.ReceiptDraftInclude;

type DraftRow = Prisma.ReceiptDraftGetPayload<{ include: typeof DRAFT_INCLUDE }>;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function toDraftView(row: DraftRow, now = new Date()): ReceiptDraftView {
  const stalled =
    row.status === "READING" && now.getTime() - row.updatedAt.getTime() > STALE_READING_MS;
  const photo = row.receipts[0];
  return {
    id: row.id,
    date: ymd(row.date),
    status: stalled ? "FAILED" : row.status,
    result:
      row.status === "READ" && row.draft
        ? {
            draft: row.draft as ReceiptDraft,
            suggestedAccount: (row.suggestedAccount ?? null) as ScanOutcome["suggestedAccount"],
            warnings: (row.warnings ?? []) as QualityWarning[],
          }
        : null,
    error: stalled ? STALLED_MESSAGE : row.status === "FAILED" ? row.error : null,
    photo: photo
      ? { id: photo.id, fileName: photo.fileName, fileUrl: resolveReceiptFileUrl(photo) }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 仮の一覧。年月を渡すと、撮ったときに選んでいた日がその月のものだけ */
export async function listReceiptDrafts(
  db: Pick<TenantDbClient, "receiptDraft">,
  month?: { year: number; month: number },
): Promise<ReceiptDraftView[]> {
  const rows = await db.receiptDraft.findMany({
    where: month
      ? {
          date: {
            gte: monthStart(month.year, month.month),
            lt: monthStart(month.year, month.month + 1),
          },
        }
      : {},
    include: DRAFT_INCLUDE,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const now = new Date();
  return rows.map((r) => toDraftView(r, now));
}

// @db.Date の列は UTC の 0 時で比べる
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));

async function findDraft(db: Pick<TenantDbClient, "receiptDraft">, id: number) {
  const row = await db.receiptDraft.findFirst({ where: { id }, include: DRAFT_INCLUDE });
  if (!row) throw notFound("仮の明細が見つかりません（登録・削除済みかもしれません）");
  return row;
}

export async function getReceiptDraft(db: Pick<TenantDbClient, "receiptDraft">, id: number) {
  return toDraftView(await findDraft(db, id));
}

/** 写真を保存して仮を作り、読み取りを始める（読み取りの終わりは待たない） */
export async function createReceiptDraft(
  db: Pick<TenantDbClient, "receiptDraft" | "receipt">,
  user: { id: number; tenantId: number },
  upload: UploadedFile,
  date: Date,
): Promise<ReceiptDraftView> {
  const stored = await storeTenantUpload(user.tenantId, upload);
  const draft = await db.receiptDraft.create({
    data: { tenantId: user.tenantId, userId: user.id, date, status: "READING" },
  });
  await db.receipt.create({ data: { ...stored, receiptDraftId: draft.id } });
  startReading(user.tenantId, draft.id);
  return getReceiptDraft(db, draft.id);
}

/** 読み取れなかった・止まった仮を、もう一度読み取る */
export async function rereadReceiptDraft(
  db: Pick<TenantDbClient, "receiptDraft">,
  tenantId: number,
  id: number,
): Promise<ReceiptDraftView> {
  const view = toDraftView(await findDraft(db, id));
  if (view.status === "READING") return view;
  await db.receiptDraft.update({
    where: { id },
    data: { status: "READING", error: null },
  });
  startReading(tenantId, id);
  return getReceiptDraft(db, id);
}

// 読み取りは 1 枚ずつ（OCR サービスは同時に 1 枚しか読まず、待ちが長いと混雑で断られるため）
let queue: Promise<unknown> = Promise.resolve();

function startReading(tenantId: number, id: number) {
  runInBackground(`receipt-draft:${id}`, () => {
    const run = queue.then(() => readReceiptDraft(tenantId, id));
    queue = run.catch(() => undefined);
    return run;
  });
}

/** 仮の写真を読み取り、結果を仮に入れる。回数の上限・読み取れない画像は、理由を残して FAILED にする */
export async function readReceiptDraft(tenantId: number, id: number): Promise<void> {
  const db = tenantDb(tenantId);
  const row = await db.receiptDraft.findFirst({ where: { id }, include: DRAFT_INCLUDE });
  // 読み取りを待つあいだに登録・削除された
  if (!row || row.status !== "READING") return;
  const photo = row.receipts[0];
  const image = photo?.savedName ? await uploadStorage().get(tenantId, photo.savedName) : null;
  if (!image) {
    await finish(db, id, { status: "FAILED", error: "写真が見つかりません。撮り直してください" });
    return;
  }
  try {
    const outcome = await scanReceipt(
      db,
      { id: row.userId, tenantId },
      image,
      (photo.mimeType ?? "image/jpeg") as ClaudeImageType,
    );
    await finish(db, id, {
      status: "READ",
      draft: outcome.draft as Prisma.InputJsonValue,
      suggestedAccount: (outcome.suggestedAccount ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      warnings: outcome.warnings as Prisma.InputJsonValue,
      readDate: outcome.draft.date ? new Date(`${outcome.draft.date}T00:00:00Z`) : null,
      error: null,
    });
  } catch (e) {
    const error =
      e instanceof ApiError
        ? e.message
        : "読み取れませんでした。もう一度読み取るか、手で入力してください";
    if (!(e instanceof ApiError)) console.error(`[receipt-draft] read ${id} failed:`, e);
    await finish(db, id, { status: "FAILED", error });
  }
}

// 読み取り中のものだけを書き換える（読み取りのあいだに登録・削除・読み取り直しが始まったら書かない）
async function finish(
  db: Pick<TenantDbClient, "receiptDraft">,
  id: number,
  data: Prisma.ReceiptDraftUpdateManyMutationInput,
) {
  await db.receiptDraft.updateMany({ where: { id, status: "READING" }, data });
}

/** 仮を消す（写真のファイルも消す） */
export async function deleteReceiptDraft(
  db: Pick<TenantDbClient, "receiptDraft">,
  tenantId: number,
  id: number,
): Promise<void> {
  const row = await findDraft(db, id);
  await db.receiptDraft.delete({ where: { id } });
  for (const r of row.receipts) {
    if (r.savedName) await removeTenantUpload(tenantId, r.savedName);
  }
}

/**
 * 仮を登録した明細に付け替える（POST /api/actuals の draftId。明細を作ったのと同じトランザクションで呼ぶ）。
 * 写真は証憑にし、セルフメディケーション税制の対象の額と品目も証憑に残す。仮は消す。
 * ほかの人が先に登録・削除していたら 409（明細の登録ごと取り消す）
 */
export async function attachDraftToEntry(
  db: Pick<TenantDbClient, "receiptDraft" | "receipt">,
  draftId: number,
  financialRecordId: number,
  selfMedication: { amount: number; items: SelfMedicationItem[] } | null,
): Promise<void> {
  await db.receipt.updateMany({
    where: { receiptDraftId: draftId },
    data: {
      financialRecordId,
      receiptDraftId: null,
      ...(selfMedication
        ? {
            selfMedicationAmount: selfMedication.amount,
            selfMedicationItems: selfMedication.items as Prisma.InputJsonValue,
          }
        : {}),
    },
  });
  const { count } = await db.receiptDraft.deleteMany({ where: { id: draftId } });
  if (count !== 1) {
    throw conflict("この仮の明細は、すでに登録か削除されています。画面を読み込み直してください");
  }
}
