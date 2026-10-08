import { describe, expect, it } from "vitest";
import {
  buildCoverageSnapshot,
  judgeActualsCoverage,
  remainingLagging,
  monthEndYmd,
  toYmd,
  type ActualsSource,
} from "@/lib/ledger/actuals-coverage";

const src = (kind: ActualsSource["kind"], id: number, lastDate: string | null): ActualsSource => ({
  kind,
  id,
  name: `${kind}${id}`,
  typeLabel: kind,
  lastDate,
});

describe("monthEndYmd", () => {
  it("月の末日を返す（うるう年・12 月を含む）", () => {
    expect(monthEndYmd(2026, 9)).toBe("2026-09-30");
    expect(monthEndYmd(2028, 2)).toBe("2028-02-29");
    expect(monthEndYmd(2026, 2)).toBe("2026-02-28");
    expect(monthEndYmd(2026, 12)).toBe("2026-12-31");
  });
});

describe("toYmd", () => {
  it("ローカル時刻の年月日を 0 埋めで返す", () => {
    expect(toYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("judgeActualsCoverage", () => {
  it("全ソースの最終日が月末日ちょうどなら入力済み（当日を含む）", () => {
    const r = judgeActualsCoverage(
      [src("bank", 1, "2026-09-30"), src("card", 2, "2026-10-03")],
      2026,
      9,
    );
    expect(r).toMatchObject({
      monthEnd: "2026-09-30",
      coveredThrough: "2026-09-30",
      entered: true,
      lagging: [],
    });
  });

  it("1 つでも月末日に 1 日足りなければ入力待ちで、そのソースを lagging に出す", () => {
    const r = judgeActualsCoverage(
      [src("bank", 1, "2026-10-02"), src("card", 2, "2026-09-29"), src("card", 3, "2026-09-30")],
      2026,
      9,
    );
    expect(r.entered).toBe(false);
    expect(r.coveredThrough).toBe("2026-09-29");
    expect(r.lagging).toEqual([{ kind: "card", id: 2 }]);
  });

  it("明細が無いソースは判定から外す", () => {
    const r = judgeActualsCoverage([src("bank", 1, "2026-10-01"), src("card", 2, null)], 2026, 9);
    expect(r.entered).toBe(true);
    expect(r.coveredThrough).toBe("2026-10-01");
    expect(r.lagging).toEqual([]);
  });

  it("明細のあるソースが 1 つも無ければ入力済みにしない", () => {
    expect(judgeActualsCoverage([], 2026, 9)).toMatchObject({
      coveredThrough: null,
      entered: false,
    });
    expect(judgeActualsCoverage([src("card", 1, null)], 2026, 9).entered).toBe(false);
  });
});

describe("当月末まで変動なし", () => {
  const sources = [
    src("bank", 1, "2026-09-30"),
    src("card", 2, "2026-09-20"),
    src("card", 3, "2026-09-25"),
    src("card", 4, null),
  ];
  const coverage = judgeActualsCoverage(sources, 2026, 9);

  it("届いていないソースすべてに印を付けると、残りは無い（確定できる）", () => {
    expect(
      remainingLagging(coverage, [
        { kind: "card", id: 2 },
        { kind: "card", id: 3 },
      ]),
    ).toEqual([]);
  });

  it("一部だけなら、印の無いソースが残る", () => {
    expect(remainingLagging(coverage, [{ kind: "card", id: 2 }])).toEqual([
      { kind: "card", id: 3 },
    ]);
  });

  it("確定時点の記録には全ソースの最終日と印が入り、届いているソースへの印は無視する", () => {
    const snap = buildCoverageSnapshot(sources, coverage, [
      { kind: "card", id: 2 },
      { kind: "bank", id: 1 },
    ]);
    expect(snap.monthEnd).toBe("2026-09-30");
    expect(snap.coveredThrough).toBe("2026-09-20");
    expect(snap.sources.map((s) => [s.kind, s.id, s.lastDate, s.noChange])).toEqual([
      ["bank", 1, "2026-09-30", false],
      ["card", 2, "2026-09-20", true],
      ["card", 3, "2026-09-25", false],
      ["card", 4, null, false],
    ]);
  });
});
