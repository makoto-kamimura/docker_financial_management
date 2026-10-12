import { describe, expect, it } from "vitest";
import {
  changeWord,
  differenceLabel,
  flowLabel,
  flowSide,
  negativeAmountWord,
  netWord,
} from "./amount-direction";

describe("金額の向き", () => {
  it("銀行・現金・予算は正の値が入ってくる向き", () => {
    expect(flowSide("bank", 1000)).toBe("in");
    expect(flowSide("bank", -1000)).toBe("out");
    expect(flowLabel("bank", 1000)).toBe("入金");
    expect(flowLabel("bank", -1000)).toBe("出金");
    expect(flowLabel("cash", -1)).toBe("支出");
    expect(flowLabel("budget", 1)).toBe("収入");
  });

  it("カードは正の値が利用（出ていく向き）、負の値が返金", () => {
    expect(flowSide("card", 1000)).toBe("out");
    expect(flowSide("card", -1000)).toBe("in");
    expect(flowLabel("card", 1000)).toBe("利用");
    expect(flowLabel("card", -1000)).toBe("返金");
  });

  it("0（四捨五入して 0 も含む）は向きなし", () => {
    expect(flowSide("bank", 0)).toBe("none");
    expect(flowSide("card", -0.4)).toBe("none");
    expect(flowLabel("bank", 0)).toBe("");
  });
});

describe("予実の差の言葉", () => {
  it("費用は余り・超過、収入は上振れ・不足", () => {
    expect(differenceLabel("EXPENSE", -5000)).toBe("余り");
    expect(differenceLabel("COGS", 5000)).toBe("超過");
    expect(differenceLabel("REVENUE", 5000)).toBe("上振れ");
    expect(differenceLabel("REVENUE", -5000)).toBe("不足");
    expect(differenceLabel("EXPENSE", 0)).toBe("予算どおり");
  });
});

describe("増減・赤字の言葉", () => {
  it("changeWord", () => {
    expect(changeWord(1)).toBe("増");
    expect(changeWord(-1)).toBe("減");
    expect(changeWord(0)).toBe("");
  });

  it("netWord は負のときだけ言葉を返す", () => {
    expect(netWord(-1)).toBe("赤字");
    expect(netWord(-1, "債務超過")).toBe("債務超過");
    expect(netWord(0)).toBe("");
    expect(netWord(100)).toBe("");
  });
});

describe("科目の金額が負のときの言葉", () => {
  it("収入は減額、それ以外は戻り", () => {
    expect(negativeAmountWord("REVENUE")).toBe("減額");
    expect(negativeAmountWord("EXPENSE")).toBe("戻り");
    expect(negativeAmountWord("COGS")).toBe("戻り");
  });
});
