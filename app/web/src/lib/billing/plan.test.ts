import { describe, expect, it } from "vitest";
import { PAST_DUE_GRACE_MS, graceUntil, isPremiumSubscription } from "./plan";

const now = new Date("2026-10-18T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

describe("isPremiumSubscription", () => {
  it("active・trialing は有料プラン", () => {
    expect(isPremiumSubscription({ status: "ACTIVE", pastDueSince: null }, now)).toBe(true);
    expect(isPremiumSubscription({ status: "TRIALING", pastDueSince: null }, now)).toBe(true);
  });

  it("申し込みの途中・解約済みは無料プラン", () => {
    expect(isPremiumSubscription({ status: "INCOMPLETE", pastDueSince: null }, now)).toBe(false);
    expect(isPremiumSubscription({ status: "CANCELED", pastDueSince: null }, now)).toBe(false);
  });

  it("支払いに失敗してから 7 日のあいだは有料プランのまま", () => {
    expect(isPremiumSubscription({ status: "PAST_DUE", pastDueSince: daysAgo(6) }, now)).toBe(true);
    expect(isPremiumSubscription({ status: "PAST_DUE", pastDueSince: daysAgo(7) }, now)).toBe(
      false,
    );
    // 起点が記録されていない（通知の順番が前後した）ときは、有料プランとして扱う
    expect(isPremiumSubscription({ status: "PAST_DUE", pastDueSince: null }, now)).toBe(true);
  });
});

describe("graceUntil", () => {
  it("past_due のときだけ、猶予の期限を返す", () => {
    const since = daysAgo(1);
    expect(graceUntil({ status: "PAST_DUE", pastDueSince: since })?.getTime()).toBe(
      since.getTime() + PAST_DUE_GRACE_MS,
    );
    expect(graceUntil({ status: "ACTIVE", pastDueSince: since })).toBeNull();
  });
});
