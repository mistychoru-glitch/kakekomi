import { test } from "node:test";
import assert from "node:assert/strict";
import { isCommonPassword } from "../src/passwords.ts";
import { SEARCH_ALLOWED_DOMAINS } from "../src/anthropic.ts";

test("ありふれた・推測されやすいパスワードは断る", () => {
  const weak = [
    "password1",
    "Password123",
    "qwerty123",
    "abc12345",
    "12345678a",
    "a1234567",
    "1qaz2wsx3",
    "aaaaaaa1",
    "kakekomi1",
    "Admin9075x",
    "abcdefg1",
    "tokyo2026",
  ];
  for (const p of weak) assert.equal(isCommonPassword(p), true, p);
});

test("メールアドレスと同じ・メールの@より前を含むパスワードは断る", () => {
  assert.equal(isCommonPassword("taro.yamada1", "taro.yamada@example.com"), true);
  assert.equal(isCommonPassword("Zq8!taroyamada", "taroyamada@example.com"), true);
  assert.equal(isCommonPassword("a@b.cd1234", "a@b.cd1234"), true);
});

test("ふつうのパスワードは通す。長い合言葉は、ありふれた単語を含んでも通す", () => {
  const ok = ["Xk9mQ2vL7p", "ねこ3びきHouse", "t4Rb-9sWm-Lp2x"];
  for (const p of ok) assert.equal(isCommonPassword(p, "taro@example.com"), false, p);
  assert.equal(isCommonPassword("correct-horse-password-battery-9"), false);
});

test("web検索の対象は、公式機関・自治体・主要な相場サイトに絞られていて、広すぎる指定がない", () => {
  assert.ok(SEARCH_ALLOWED_DOMAINS.includes("go.jp") && SEARCH_ALLOWED_DOMAINS.includes("lg.jp"));
  assert.ok(SEARCH_ALLOWED_DOMAINS.includes("suumo.jp"));
  for (const d of SEARCH_ALLOWED_DOMAINS) {
    assert.match(d, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${d}: ドメインの形式`);
    assert.ok(!["com", "jp", "net", "org", "or.jp", "co.jp", "ne.jp"].includes(d), `${d}: 広すぎる`);
  }
});
