import { z } from "zod";

// 金額の共通スキーマ（予算・実績・配分適用などで共用）。負値・非数値・極端な桁数を拒否する。
export const zMoney = z.coerce.number().finite().min(0).max(1e14);
