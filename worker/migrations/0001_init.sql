-- ユーザー登録
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'guest', -- guest / retain(100円) / active(500円〜)
  created_at TEXT NOT NULL
);

-- まとめノート（登録ユーザーのみ保存対象。匿名利用時はここに一切書き込まない）
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  structured_state_json TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  payment_hold_until TEXT,
  updated_at TEXT NOT NULL
);

-- 匿名投稿ティーザー（個人を特定しない範囲のみ）
CREATE TABLE shared_teaser_posts (
  id TEXT PRIMARY KEY,
  category TEXT,
  urgency_level TEXT,
  posted_at TEXT NOT NULL
);

CREATE INDEX idx_notes_user_id ON notes(user_id);
