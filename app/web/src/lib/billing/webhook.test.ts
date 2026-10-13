import { describe, expect, it } from "vitest";
import { subscriptionStatus } from "./webhook";

describe("subscriptionStatus", () => {
  it("Stripe の契約の状態を写す", () => {
    expect(subscriptionStatus("active")).toBe("ACTIVE");
    expect(subscriptionStatus("trialing")).toBe("TRIALING");
    expect(subscriptionStatus("past_due")).toBe("PAST_DUE");
    expect(subscriptionStatus("incomplete")).toBe("INCOMPLETE");
  });

  it("unpaid・paused・incomplete_expired は解約済みとして扱う", () => {
    expect(subscriptionStatus("canceled")).toBe("CANCELED");
    expect(subscriptionStatus("unpaid")).toBe("CANCELED");
    expect(subscriptionStatus("paused")).toBe("CANCELED");
    expect(subscriptionStatus("incomplete_expired")).toBe("CANCELED");
  });
});
