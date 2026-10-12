-- 予算配分ルールの既定値を見直す（lib/budget/default-allocation-rules.ts の DEFAULT_ALLOCATION_RULES と同じ値）。
--
-- これまでの既定値は、推奨（幅の中央、上限なしは下限）の合計が 117.5% で、収入を超えて配分していた。
-- 中央の合計がちょうど 100% になるようにし、子ども・車が無い世帯のために教育費と車の下限を 0% にする。
-- 小遣いは娯楽・交際費のルールに入れる。
--
-- ユーザーが変えたルールは触らない。割合・ラベル・注記・キーワードそれぞれ、旧既定値のままの行だけを書き換える。

-- 割合
UPDATE "allocation_rules" r
SET "minPercent" = d.new_min, "maxPercent" = d.new_max, "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('utilities',     5,  8::numeric,    4,  6::numeric),
  ('communication', 3,  6::numeric,    3,  5::numeric),
  ('insurance',     5,  10::numeric,   4,  6::numeric),
  ('food',          15, 20::numeric,   12, 18::numeric),
  ('car',           5,  15::numeric,   0,  10::numeric),
  ('education',     5,  15::numeric,   0,  10::numeric),
  ('leisure',       5,  10::numeric,   6,  10::numeric),
  ('savings',       20, NULL::numeric, 10, 30::numeric),
  ('other_fixed',   0,  5::numeric,    0,  4::numeric),
  ('other_living',  0,  5::numeric,    0,  4::numeric)
) AS d(key, old_min, old_max, new_min, new_max)
WHERE r."key" = d.key
  AND r."minPercent" = d.old_min
  AND r."maxPercent" IS NOT DISTINCT FROM d.old_max;

-- ラベル
UPDATE "allocation_rules" r
SET "label" = d.new_label, "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('car',       '車関連（ガソリン・保険・駐車場など）', '車関連（ガソリン・駐車場・車検など）'),
  ('education', '教育費（子どもがいる場合）',          '教育費'),
  ('leisure',   '娯楽・交際費',                        '娯楽・交際費・小遣い')
) AS d(key, old_label, new_label)
WHERE r."key" = d.key AND r."label" = d.old_label;

-- 注記
UPDATE "allocation_rules" r
SET "note" = d.new_note, "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('rent',      '理想は25%以内',  '理想は25%以内。住宅ローンの返済を含む'),
  ('insurance', NULL,             '生命・医療・損害保険の合計。社会保険は含まない'),
  ('car',       NULL,             '車が無ければ0%'),
  ('education', NULL,             '子どもがいない場合は0%'),
  ('savings',   '最低10%は確保',  '理想は20%以上。最低でも10%は確保')
) AS d(key, old_note, new_note)
WHERE r."key" = d.key AND r."note" IS NOT DISTINCT FROM d.old_note;

-- キーワード（娯楽・交際費に小遣いを足す）
UPDATE "allocation_rules"
SET "keywords" = ARRAY['娯楽','外食','交際','趣味','旅行','冠婚葬祭','贈答','小遣い','こづかい'],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'leisure'
  AND "keywords" = ARRAY['娯楽','外食','交際','趣味','旅行','冠婚葬祭','贈答'];
