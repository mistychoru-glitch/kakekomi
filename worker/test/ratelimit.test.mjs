import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIp } from "../src/rateLimit.ts";

test("IPv4はそのまま", () => {
  assert.equal(normalizeIp("203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIp("unknown"), "unknown");
});

test("IPv6は前半64ビット(/64)にそろえる: 同じ/64なら同じキーになる", () => {
  const a = normalizeIp("240f:144:162d:1:9a0:1a05:2e2f:66ab");
  const b = normalizeIp("240f:144:162d:1:ffff:aaaa:1:2"); // 同じ/64で別のアドレス（プライバシー拡張で変わる部分）
  assert.equal(a, b);
  assert.equal(a, "240f:144:162d:1::/64");
});

test("IPv6は別の/64なら別のキーになる", () => {
  assert.notEqual(normalizeIp("240f:144:162d:1::1"), normalizeIp("240f:144:162d:2::1"));
});

test("::省略の表記ゆれ・大文字小文字・先頭ゼロでも同じキーになる", () => {
  const expected = "2001:db8:0:0::/64";
  assert.equal(normalizeIp("2001:db8::1"), expected);
  assert.equal(normalizeIp("2001:0db8:0000:0000:0000:0000:0000:0001"), expected);
  assert.equal(normalizeIp("2001:DB8::ffff"), expected);
  assert.equal(normalizeIp("::1"), "0:0:0:0::/64");
});

test("IPv4射影アドレスはIPv4として数える", () => {
  assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
});
