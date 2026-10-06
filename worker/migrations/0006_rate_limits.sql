-- 回数制限の保存先をKVからD1へ移す。
-- KVの無料枠は書き込み1日1,000回までで、リクエストごとに書き込む回数制限には足りない。
-- D1は無料枠でも書き込み1日10万回あり、1文での原子的なカウントもできる。
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL -- UNIX秒。これを過ぎた行は無効（次回アクセス時に数え直す）
);

CREATE INDEX idx_rate_limits_expires ON rate_limits(expires_at);
