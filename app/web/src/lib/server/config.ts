import { Env } from "@/lib/server/config-schema";

// S-13: 環境変数をまとめて検証し、型付きオブジェクトとして返す。
// 従来は process.env.X を各所で直接参照しており、未設定・誤設定が実行時まで
// 発覚しなかった（例: CLEANUP_SERVICE_KEY に短い推測可能な値が本番混入する等）。
// 最初に getConfig() を呼んだ時点で Env.parse() が走り、不正な値があれば例外を投げる。
// import しただけでは検証しない（auth.ts・upload.ts を import する単体テストが、
// DATABASE_URL などを用意しなくても動くようにするため）。スキーマ自体は
// lib/server/config-schema.ts に分離しており、そちらはテストから副作用なく検証できる。
//
// Edge ランタイム（middleware.ts）からは import しないこと。session-constants.ts
// が Edge 対応のため直接 process.env を読んでいるのと同じ理由で、Edge の
// 環境変数取得は Node ランタイムと制約が異なる。
let parsed: Env | null = null;

export function getConfig(): Env {
  parsed ??= Env.parse(process.env);
  return parsed;
}
