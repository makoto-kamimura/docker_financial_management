-- 監査ログに before/after 差分カラムを追加
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS before TEXT,
  ADD COLUMN IF NOT EXISTS after  TEXT;
