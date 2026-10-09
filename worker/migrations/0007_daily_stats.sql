-- 利用数の記録。日付(日本時間)ごとの件数だけを持つ。
-- 会話の内容・IPアドレス・メールアドレスなど、個人を特定できる情報は一切入れない。
CREATE TABLE daily_stats (
  day TEXT NOT NULL,    -- 例: 2026-10-09（日本時間）
  metric TEXT NOT NULL, -- consultations / messages / summaries / registrations / crisis
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
