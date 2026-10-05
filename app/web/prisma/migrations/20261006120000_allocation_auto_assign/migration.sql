-- 予算配分ルールへの科目の自動振り分け。
--
-- これまでは 1 ルールにつき科目 1 つ（allocation_rules.accountId）しか結び付けられず、
-- 追加した科目はどのルールにも入らなかった。これからは科目名のキーワード（keywords）と
-- 受け皿の区分（fallbackCategory）でその場で振り分け、手で移した分だけを
-- allocation_account_assignments に保存する（lib/allocation-assign.ts）。

-- AlterTable
ALTER TABLE "allocation_rules"
ADD COLUMN     "fallbackCategory" "AccountCategory",
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "allocation_account_assignments" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "ruleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_account_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allocation_account_assignments_accountId_key" ON "allocation_account_assignments"("accountId");

-- CreateIndex
CREATE INDEX "allocation_account_assignments_tenantId_idx" ON "allocation_account_assignments"("tenantId");

-- CreateIndex
CREATE INDEX "allocation_account_assignments_ruleId_idx" ON "allocation_account_assignments"("ruleId");

-- AddForeignKey
ALTER TABLE "allocation_account_assignments" ADD CONSTRAINT "allocation_account_assignments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_account_assignments" ADD CONSTRAINT "allocation_account_assignments_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "allocation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の結び付け（ユーザーが選んだ科目）を手動の割り当てに移す。
-- 同じ科目が複数のルールに結び付いていた場合は、並び順の先のルールを採る（1 科目 1 ルール）。
INSERT INTO "allocation_account_assignments" ("tenantId", "accountId", "ruleId")
SELECT DISTINCT ON (r."accountId") r."tenantId", r."accountId", r."id"
FROM "allocation_rules" r
WHERE r."accountId" IS NOT NULL
ORDER BY r."accountId", r."sortOrder", r."id";

-- 既定の key のルールに既定のキーワードを入れる（ユーザーが入れたキーワードは上書きしない）。
-- 値は lib/default-allocation-rules.ts の DEFAULT_ALLOCATION_RULES と同じ。
UPDATE "allocation_rules" r SET "keywords" = d.keywords
FROM (VALUES
  ('rent',          ARRAY['家賃','住宅ローン','管理費','修繕積立','住宅修繕']),
  ('utilities',     ARRAY['電気','ガス','水道','光熱']),
  ('communication', ARRAY['回線','通信','スマホ','携帯','インターネット']),
  ('insurance',     ARRAY['生命保険','医療保険','がん保険','火災保険','地震保険','学資保険','自動車保険','ペット保険','傷害保険','個人年金']),
  ('food',          ARRAY['食費','飲料','食料']),
  ('car',           ARRAY['ガソリン','駐車','車検','高速道路','自動車','車']),
  ('daily',         ARRAY['日用品','消耗品','被服','衣服','美容','化粧']),
  ('education',     ARRAY['教育','学費','習い事','書籍','子育て','育児']),
  ('leisure',       ARRAY['娯楽','外食','交際','趣味','旅行','冠婚葬祭','贈答']),
  ('savings',       ARRAY['貯蓄','積立','投資','NISA','iDeCo','預金'])
) AS d(key, keywords)
WHERE r."key" = d.key AND cardinality(r."keywords") = 0;

-- 受け皿の 2 ルールを、配分ルールを持つ各テナントに追加する（key が無ければ）。
INSERT INTO "allocation_rules"
  ("tenantId", "key", "label", "group", "minPercent", "maxPercent", "note", "fallbackCategory", "sortOrder", "updatedAt")
SELECT t."tenantId", d.key, d.label, d."group", 0, 5, d.note, d.category::"AccountCategory",
       t.max_sort + d.offs, CURRENT_TIMESTAMP
FROM (SELECT "tenantId", MAX("sortOrder") AS max_sort FROM "allocation_rules" GROUP BY "tenantId") t
CROSS JOIN (VALUES
  ('other_fixed',  'その他の固定費', '固定費', 'どのキーワードにも当たらない固定費の科目が入る', 'EXPENSE', 1),
  ('other_living', 'その他の生活費', '生活費', 'どのキーワードにも当たらない変動費の科目が入る', 'COGS', 2)
) AS d(key, label, "group", note, category, offs)
WHERE NOT EXISTS (
  SELECT 1 FROM "allocation_rules" x WHERE x."tenantId" = t."tenantId" AND x."key" = d.key
);

-- DropForeignKey
ALTER TABLE "allocation_rules" DROP CONSTRAINT "allocation_rules_accountId_fkey";

-- AlterTable
ALTER TABLE "allocation_rules" DROP COLUMN "accountId";
