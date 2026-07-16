import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { TENANT_SCOPED_MODELS, TENANT_SCOPE_EXCLUDED_MODELS } from "./tenant-db";

// テナント分離の「仕組み」による再発防止テスト。
// schema.prisma に tenantId 列を持つモデルを追加したとき、
// TENANT_SCOPED_MODELS（自動スコープ）か TENANT_SCOPE_EXCLUDED_MODELS（理由付き除外）の
// どちらかに必ず登録されていることを保証する。登録漏れ = テナント越境リスクなので CI を落とす。
describe("tenant-db スコープ対象の網羅性", () => {
  const modelsWithTenantId = Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId" && f.kind === "scalar"))
    .map((m) => m.name);

  it("tenantId を持つ全モデルが SCOPED または EXCLUDED に登録されている", () => {
    const unregistered = modelsWithTenantId.filter(
      (name) => !TENANT_SCOPED_MODELS.has(name) && !TENANT_SCOPE_EXCLUDED_MODELS.has(name),
    );
    expect(unregistered, `テナントスコープ未登録のモデル: ${unregistered.join(", ")}`).toEqual([]);
  });

  it("SCOPED に登録された全モデルが実在し tenantId 列を持つ", () => {
    const invalid = [...TENANT_SCOPED_MODELS].filter((name) => !modelsWithTenantId.includes(name));
    expect(invalid, `tenantId 列が無い/存在しないモデル: ${invalid.join(", ")}`).toEqual([]);
  });

  it("SCOPED と EXCLUDED は重複しない", () => {
    const overlap = [...TENANT_SCOPED_MODELS].filter((name) =>
      TENANT_SCOPE_EXCLUDED_MODELS.has(name),
    );
    expect(overlap).toEqual([]);
  });
});
