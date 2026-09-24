-- ログイン用の一意なIDを、自由入力の表示名(display_name)とは別に持つ。
-- display_nameは重複してよい「呼び名」、login_idはログインに使う一意な識別子。
ALTER TABLE users ADD COLUMN login_id TEXT;

CREATE UNIQUE INDEX idx_users_login_id ON users(login_id);
