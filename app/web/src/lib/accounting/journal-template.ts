import { z } from "zod";

// 仕訳テンプレートの共通 include（明細 + 科目、表示順）
export const TEMPLATE_INCLUDE = {
  lines: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

// テンプレート明細行の入力スキーマ（登録・全置換更新で共用）
export const TemplateLineSchema = z.object({
  side: z.string().min(1),
  accountId: z.number().int().positive(),
  amount: z.number().optional(), // null = 仕訳作成時に入力
  note: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

export type TemplateLineInput = z.infer<typeof TemplateLineSchema>;

// 入力行を Prisma の作成データへ整形する（sortOrder 未指定は配列順）
export function toTemplateLineData(lines: TemplateLineInput[]) {
  return lines.map((l, i) => ({
    side: l.side,
    accountId: l.accountId,
    amount: l.amount ?? null,
    note: l.note ?? null,
    sortOrder: l.sortOrder ?? i,
  }));
}
