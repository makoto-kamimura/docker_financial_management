-- 在庫管理の高度化: itemType / valuationMethod 追加
ALTER TABLE inventories
  ADD COLUMN IF NOT EXISTS "valuationMethod" TEXT NOT NULL DEFAULT 'last_purchase';

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS "itemType" TEXT NOT NULL DEFAULT 'product';

-- 仕入税額控除管理: journal_details に taxRate / taxCreditEligible 追加
ALTER TABLE journal_details
  ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5, 4),
  ADD COLUMN IF NOT EXISTS "taxCreditEligible" BOOLEAN NOT NULL DEFAULT TRUE;

-- 電子帳簿保存法: journal_entries に approvalStatus 追加
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'approved';

CREATE INDEX IF NOT EXISTS "journal_entries_approvalStatus_idx"
  ON journal_entries ("approvalStatus");

-- 電子帳簿保存法: journal_approvals テーブル作成
CREATE TABLE IF NOT EXISTS journal_approvals (
  id                SERIAL PRIMARY KEY,
  "journalEntryId"  INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  action            TEXT NOT NULL,  -- submitted / approved / rejected
  "actorId"         INT NOT NULL REFERENCES users(id),
  comment           TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "journal_approvals_journalEntryId_idx"
  ON journal_approvals ("journalEntryId");
