import { describe, expect, it } from "vitest";
import { TransferCreateSchema, TransferPatchSchema } from "./transfer-schema";

// 銀行管理カレンダーの「毎月◯日の入出金を追加」フォームが送る形。
// ラベル・メモは任意項目で、未入力時は null が送られる。
const fromCalendarForm = (over: Record<string, unknown> = {}) => ({
  fromAccountId: 8,
  toAccountId: null,
  label: null,
  channel: "AUTO_DEBIT",
  day: 27,
  amount: 50000,
  note: null,
  kind: "AUTO",
  linkedAccountId: null,
  ...over,
});

describe("TransferCreateSchema", () => {
  it("ラベル・メモ未入力（null）でも登録できる", () => {
    // 以前は label / note が optional のみで、null が invalid_type で弾かれ
    // 「追加に失敗しました」になっていた
    const r = TransferCreateSchema.safeParse(fromCalendarForm());
    expect(r.success).toBe(true);
  });

  it("ラベル・メモを入力した場合も通る", () => {
    const r = TransferCreateSchema.safeParse(
      fromCalendarForm({ label: "家賃", note: "毎月27日引き落とし" }),
    );
    expect(r.success).toBe(true);
  });

  it("入金方向（fromAccountId が null）でも通る", () => {
    const r = TransferCreateSchema.safeParse(
      fromCalendarForm({ fromAccountId: null, toAccountId: 8, channel: "INCOME" }),
    );
    expect(r.success).toBe(true);
  });

  it("出金元・入金先の両方が未指定なら弾く", () => {
    const r = TransferCreateSchema.safeParse(
      fromCalendarForm({ fromAccountId: null, toAccountId: null }),
    );
    expect(r.success).toBe(false);
  });

  it("出金元と入金先が同じなら弾く", () => {
    const r = TransferCreateSchema.safeParse(fromCalendarForm({ toAccountId: 8 }));
    expect(r.success).toBe(false);
  });

  it("日は 1〜31 の範囲外を弾く", () => {
    expect(TransferCreateSchema.safeParse(fromCalendarForm({ day: 0 })).success).toBe(false);
    expect(TransferCreateSchema.safeParse(fromCalendarForm({ day: 32 })).success).toBe(false);
    expect(TransferCreateSchema.safeParse(fromCalendarForm({ day: 31 })).success).toBe(true);
  });

  it("金額は正の数のみ", () => {
    expect(TransferCreateSchema.safeParse(fromCalendarForm({ amount: 0 })).success).toBe(false);
    expect(TransferCreateSchema.safeParse(fromCalendarForm({ amount: -1 })).success).toBe(false);
  });
});

describe("TransferPatchSchema", () => {
  it("ラベル・メモを null でクリアできる", () => {
    const r = TransferPatchSchema.safeParse({ label: null, note: null });
    expect(r.success).toBe(true);
  });

  it("空オブジェクト（変更なし）でも通る", () => {
    expect(TransferPatchSchema.safeParse({}).success).toBe(true);
  });
});
