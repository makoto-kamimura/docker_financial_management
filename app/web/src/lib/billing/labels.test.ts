import { describe, expect, it } from "vitest";
import { subscriptionStatusText } from "./labels";

const base = {
  currentPeriodEnd: "2026-11-18T00:00:00Z",
  cancelAtPeriodEnd: false,
  graceUntil: null,
  canceledAt: null,
};

describe("subscriptionStatusText", () => {
  it("契約が無ければ何も出さない", () => {
    expect(subscriptionStatusText(null)).toBeNull();
  });

  it("契約中は次の更新日、解約予定なら解約される日を出す", () => {
    expect(subscriptionStatusText({ ...base, status: "ACTIVE" })).toContain("次の更新日");
    expect(
      subscriptionStatusText({ ...base, status: "ACTIVE", cancelAtPeriodEnd: true }),
    ).toContain("解約されます");
  });

  it("支払いに失敗したときは、猶予の期限までに更新するよう促す", () => {
    expect(
      subscriptionStatusText({ ...base, status: "PAST_DUE", graceUntil: "2026-10-25T00:00:00Z" }),
    ).toContain("までに支払い方法を更新");
  });
});
