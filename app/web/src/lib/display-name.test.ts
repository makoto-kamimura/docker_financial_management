import { describe, it, expect } from "vitest";
import { displayName } from "./display-name";

describe("displayName", () => {
  const account = { name: "食費", soleName: "仕入・変動費", corporateName: "売上原価" };

  it("household は常に家庭科目名を返す", () => {
    expect(displayName(account, "household")).toBe("食費");
  });

  it("sole は soleName を返す", () => {
    expect(displayName(account, "sole")).toBe("仕入・変動費");
  });

  it("corporate は corporateName を返す", () => {
    expect(displayName(account, "corporate")).toBe("売上原価");
  });

  it("sole/corporate で表示名が null の場合は家庭科目名にフォールバックする", () => {
    const noOverride = { name: "食費", soleName: null, corporateName: null };
    expect(displayName(noOverride, "sole")).toBe("食費");
    expect(displayName(noOverride, "corporate")).toBe("食費");
  });

  it("soleName/corporateName が未指定（undefined）でもフォールバックする", () => {
    const bare = { name: "食費" };
    expect(displayName(bare, "sole")).toBe("食費");
    expect(displayName(bare, "corporate")).toBe("食費");
  });
});
