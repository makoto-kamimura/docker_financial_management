-- 実物資産を純資産に計上するかを明示フラグで持つ。
--
-- 背景: 従来は isCountedAsAsset() が「紐付け負債科目がある資産は LAND / BUILDING のみ計上」
-- というカテゴリ判定を行っていた。これは住宅ローンに含まれる諸費用（登記費用・手数料等）を
-- 資産から除くための措置だったが、カーローンを紐付けた車や、借入で購入した金なども
-- まとめて除外されてしまい、純資産がその評価額分だけ過小に出ていた。
--
-- 対応: 「資産価値を持つか」をカテゴリで代理判定するのをやめ、countAsAsset で明示する。

-- AlterTable
ALTER TABLE "personal_assets" ADD COLUMN "countAsAsset" BOOLEAN NOT NULL DEFAULT true;

-- 既存行は従来の判定結果で初期化し、移行時点の表示を変えない。
-- （紐付け負債があり、かつ土地・建物以外 → 資産計上外）
UPDATE "personal_assets"
   SET "countAsAsset" = false
 WHERE "linkedAccountId" IS NOT NULL
   AND "category" NOT IN ('LAND', 'BUILDING');
