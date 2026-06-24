-- MFA リカバリーコード用カラムを users テーブルに追加
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "mfaRecoveryCodes" TEXT;
