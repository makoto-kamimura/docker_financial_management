-- 借入金の入力を借入金管理に集める（資産の画面からはローンの項目を外した）ためのデータの移し替え。
-- スキーマは変えない。
--
-- 1. 資産にひも付いたローンで予算連携先が空のものは、資産の「紐付け負債科目」を予算連携先にする。
--    予算への上乗せは、今と同じ科目に入り続ける（上乗せはローンの予算連携先から取るように変えた）。
UPDATE "loans" AS l
SET "linkedAccountId" = a."linkedAccountId"
FROM "personal_assets" AS a
WHERE a."loanId" = l."id"
  AND l."linkedAccountId" IS NULL
  AND a."linkedAccountId" IS NOT NULL;

-- 2. 種別が「実物資産の負債」（asset）のローンを、資産の種別から決め直す
--    （土地・建物は住宅ローン、車はカーローン、ほかはその他の借入）。
UPDATE "loans" AS l
SET "loanType" = CASE a."category"
    WHEN 'LAND' THEN 'housing'
    WHEN 'BUILDING' THEN 'housing'
    WHEN 'VEHICLE' THEN 'car'
    ELSE 'other'
  END
FROM "personal_assets" AS a
WHERE a."loanId" = l."id"
  AND l."loanType" = 'asset';

-- 資産が消えて残った asset 種別のローンは、その他の借入にする
UPDATE "loans" SET "loanType" = 'other' WHERE "loanType" = 'asset';
