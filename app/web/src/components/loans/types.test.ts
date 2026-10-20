import { describe, expect, it } from "vitest";
import { HOME_ACCOUNTS_SEED } from "@/lib/accounting/default-accounts";
import { defaultLinkedAccountCode } from "./types";

describe("defaultLinkedAccountCode", () => {
  it("住宅ローンは家賃、カーローンは自動車ローン返済", () => {
    expect(defaultLinkedAccountCode("housing")).toBe("H-3018");
    expect(defaultLinkedAccountCode("car")).toBe("H-3040");
  });

  it("ほかの種別は既定を持たない", () => {
    expect(defaultLinkedAccountCode("business")).toBe("");
    expect(defaultLinkedAccountCode("other")).toBe("");
  });

  it("既定の科目は、明細に付けられる費用の科目", () => {
    for (const type of ["housing", "car"]) {
      const account = HOME_ACCOUNTS_SEED.find((a) => a.code === defaultLinkedAccountCode(type));
      expect(account?.category).toBe("EXPENSE");
    }
  });
});
