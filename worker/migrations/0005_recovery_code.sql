-- パスワード再設定用のリカバリーコード（ハッシュのみ保存。平文は登録時に一度だけ本人へ表示）。
-- メール送信の仕組みを持たないため、メールアドレス + このコードで本人確認する。
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
