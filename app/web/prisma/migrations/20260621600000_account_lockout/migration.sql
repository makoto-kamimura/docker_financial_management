-- アカウントロックアウト用カラムを追加
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "loginAttempts" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil"   TIMESTAMPTZ;
