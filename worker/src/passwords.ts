// 推測されやすいパスワードを、登録・再設定のときに断る（長さと英数字の条件に加えて）。
// 完全な辞書ではなく、実際に最初に試される、ありふれた型を中心にしている。

const BAD_PARTS = [
  "password",
  "passw0rd",
  "qwerty",
  "asdfgh",
  "zxcvbn",
  "1qaz2wsx",
  "letmein",
  "iloveyou",
  "welcome",
  "monkey",
  "dragon",
  "abc123",
  "abcd1234",
  "123456",
  "654321",
  "111111",
  "000000",
  "admin",
  "kakekomi",
  "kanri",
  "sakura",
  "tokyo",
];

// 十分に長い合言葉（パスフレーズ）は、上の言葉を含んでいても許す
const LONG_ENOUGH = 16;

export function isCommonPassword(password: string, loginId = ""): boolean {
  const p = password.normalize("NFKC").toLowerCase();
  if (p.length >= LONG_ENOUGH) return false;
  if (BAD_PARTS.some((w) => p.includes(w))) return true;
  // 同じ文字の繰り返しや、ほとんど変化のないもの（aaaaaaa1 など）
  if (new Set(p).size <= 3) return true;
  // 連番（12345678a、abcdefg1 など）
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|defg|efgh)/.test(p)) return true;
  // メールアドレスや、その@より前の部分を、そのまま使っている
  const id = loginId.normalize("NFKC").toLowerCase();
  const local = id.split("@")[0];
  if (id && p === id) return true;
  if (local.length >= 4 && p.includes(local)) return true;
  return false;
}
