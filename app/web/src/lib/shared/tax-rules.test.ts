import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAX_RULES,
  TAX_RULE_FIELDS,
  TAX_RULE_GROUPS,
  copyRulesFromPreviousYear,
  defaultRulesFor,
  diffRules,
  getRuleValue,
  mergeRules,
  resolveRules,
  validateRuleValue,
} from "./tax-rules";

describe("TAX_RULE_FIELDS", () => {
  it("すべての項目が既定値にあり、検証に通る", () => {
    for (const year of Object.keys(DEFAULT_TAX_RULES).map(Number)) {
      for (const f of TAX_RULE_FIELDS) {
        const v = getRuleValue(DEFAULT_TAX_RULES[year], f.path);
        expect(v, `${year} ${f.path}`).not.toBeUndefined();
        expect(validateRuleValue(f.path, v), `${year} ${f.path}`).toBeNull();
      }
    }
  });

  it("グループは定義済みのものだけ", () => {
    for (const f of TAX_RULE_FIELDS) expect(TAX_RULE_GROUPS, f.path).toContain(f.group);
  });
});

describe("validateRuleValue", () => {
  it("金額は 0 以上の整数、率は 0〜1", () => {
    expect(validateRuleValue("salary.minimum", 690_000)).toBeNull();
    expect(validateRuleValue("salary.minimum", -1)).toMatch(/0 以上/);
    expect(validateRuleValue("salary.minimum", 1.5)).toMatch(/整数/);
    expect(validateRuleValue("resident.rate", 1.2)).toMatch(/率/);
    expect(validateRuleValue("nope", 1)).toMatch(/知らない/);
  });

  it("区分表は上から小さい順で、上限なし（null）は最後の行だけ", () => {
    expect(
      validateRuleValue("basic.resident", [
        { upTo: 24_000_000, amount: 430_000 },
        { upTo: null, amount: 0 },
      ]),
    ).toBeNull();
    expect(
      validateRuleValue("basic.resident", [
        { upTo: 25_000_000, amount: 430_000 },
        { upTo: 24_000_000, amount: 0 },
      ]),
    ).toMatch(/小さい順/);
    expect(
      validateRuleValue("basic.resident", [
        { upTo: null, amount: 430_000 },
        { upTo: 24_000_000, amount: 0 },
      ]),
    ).not.toBeNull();
  });
});

describe("mergeRules / resolveRules", () => {
  it("上書きした項目だけ変わり、既定値は変えない", () => {
    const merged = mergeRules(DEFAULT_TAX_RULES[2026], { "resident.perCapita": 6_000 });
    expect(merged.resident.perCapita).toBe(6_000);
    expect(DEFAULT_TAX_RULES[2026].resident.perCapita).toBe(5_000);
    expect(merged.resident.rate).toBe(0.1);
  });

  it("検証に通らない値と知らない項目は無視する", () => {
    const merged = mergeRules(DEFAULT_TAX_RULES[2026], { "resident.perCapita": -5, unknown: 1 });
    expect(merged.resident.perCapita).toBe(5_000);
  });

  it("既定値と違う項目を changed に出す", () => {
    const r = resolveRules(2026, { "resident.perCapita": 6_000, "resident.rate": 0.1 });
    expect(r.changed).toEqual(["resident.perCapita"]);
    expect(r.fallback).toBe(false);
  });

  it("既定値がない年は直前の年を使い、上書きがなければ fallback", () => {
    expect(defaultRulesFor(2027)).toMatchObject({ baseYear: 2026, fallback: true });
    expect(resolveRules(2027, null).fallback).toBe(true);
    expect(resolveRules(2027, { "personal.singleParentIncome": 380_000 }).fallback).toBe(false);
    expect(defaultRulesFor(2020)).toMatchObject({ baseYear: 2025, fallback: true });
  });
});

describe("diffRules", () => {
  it("既定値と同じ項目は落とす", () => {
    expect(
      diffRules(DEFAULT_TAX_RULES[2026], { "resident.rate": 0.1, "resident.perCapita": 6_000 }),
    ).toEqual({
      "resident.perCapita": 6_000,
    });
  });
});

describe("copyRulesFromPreviousYear", () => {
  it("既定値がない来年の分は、前年の値（上書き込み）を全項目コピーする", () => {
    const copied = copyRulesFromPreviousYear(2027, { "resident.perCapita": 6_000 });
    expect(Object.keys(copied)).toHaveLength(TAX_RULE_FIELDS.length);
    expect(copied["resident.perCapita"]).toBe(6_000);
    expect(copied["salary.minimum"]).toBe(740_000);
    expect(resolveRules(2027, copied).rules.resident.perCapita).toBe(6_000);
  });

  it("既定値がある年は、その年の既定値と違う項目だけ", () => {
    const copied = copyRulesFromPreviousYear(2026, null);
    expect(copied["salary.minimum"]).toBe(650_000);
    expect(copied["resident.rate"]).toBeUndefined();
  });
});
