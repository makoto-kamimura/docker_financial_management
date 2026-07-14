import { Env } from "@/lib/config-schema";

// S-13: 環境変数を起動時に一括検証し、型付きオブジェクトとして export する。
// 従来は process.env.X を各所で直接参照しており、未設定・誤設定が実行時まで
// 発覚しなかった（例: CLEANUP_SERVICE_KEY に短い推測可能な値が本番混入する等）。
// このモジュールが最初に import された時点で Env.parse() が走り、不正な値が
// あれば例外を投げて起動を失敗させる（フェイルファスト）。スキーマ自体は
// lib/config-schema.ts に分離しており、そちらはテストから副作用なく検証できる。
//
// Edge ランタイム（middleware.ts）からは import しないこと。session-constants.ts
// が Edge 対応のため直接 process.env を読んでいるのと同じ理由で、Edge の
// 環境変数取得は Node ランタイムと制約が異なる。
export const config = Env.parse(process.env);
