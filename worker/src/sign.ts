// AIの返信の「署名」。サーバーは会話を保存しないので、ブラウザが送ってくる会話の履歴に、
// 偽の「AIの発言」を混ぜられないよう、サーバーが出した返信にだけ署名をつけて、あとで確かめる。

const PREFIX = "kakekomi-chat-v1\n";

function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(PREFIX + text)));
}

// 鍵がないときは、署名を作れない（空文字）。確かめるときは、必ず不合格にする（安全側）。
export async function signText(key: string | undefined, text: string): Promise<string> {
  if (!key) return "";
  return hmac(key, text);
}

export async function verifyText(key: string | undefined, text: string, sig: unknown): Promise<boolean> {
  if (!key || typeof sig !== "string" || sig.length < 20 || sig.length > 100) return false;
  const expected = await hmac(key, text);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
