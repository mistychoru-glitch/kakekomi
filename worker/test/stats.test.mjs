import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcludedFromStats, jstDay, recordStat, recordStatFor } from "../src/stats.ts";

test("日付は日本時間で区切る（UTCの15:00で翌日になる）", () => {
  assert.equal(jstDay(Date.UTC(2026, 9, 9, 14, 59, 59)), "2026-10-09");
  assert.equal(jstDay(Date.UTC(2026, 9, 9, 15, 0, 0)), "2026-10-10");
});

test("記録は日付と種類だけを保存する（個人を特定できる値を渡さない）", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { run: async () => ({}) };
        },
      };
    },
  };
  await recordStat(db, "consultations", Date.UTC(2026, 9, 9, 3, 0, 0));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["2026-10-09", "consultations"]);
  assert.match(calls[0].sql, /ON CONFLICT\(day, metric\) DO UPDATE SET count = count \+ 1/);
});

test("記録に失敗しても例外を投げない（相談を止めない）", async () => {
  const db = {
    prepare() {
      throw new Error("db down");
    },
  };
  await assert.doesNotReject(() => recordStat(db, "messages"));
});

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { run: async () => ({}) };
        },
      };
    },
  };
}

function reqWith(headers) {
  return new Request("https://example.test/api/chat", { method: "POST", headers });
}

test("動作確認の印がある呼び出しは、集計に入れない", async () => {
  const db = fakeDb();
  const env = { DB: db, STATS_EXCLUDE_KEY: "mark-1234" };
  await recordStatFor(env, reqWith({ "x-kakekomi-test-key": "mark-1234" }), "messages");
  assert.equal(db.calls.length, 0);
});

test("印がない・違う呼び出しは、これまでどおり集計に入る", async () => {
  const db = fakeDb();
  const env = { DB: db, STATS_EXCLUDE_KEY: "mark-1234" };
  await recordStatFor(env, reqWith({}), "messages");
  await recordStatFor(env, reqWith({ "x-kakekomi-test-key": "wrong" }), "consultations");
  assert.equal(db.calls.length, 2);
});

test("印の鍵が未設定なら、ヘッダーがあっても除外しない（空文字どうしで一致させない）", async () => {
  const db = fakeDb();
  await recordStatFor({ DB: db }, reqWith({ "x-kakekomi-test-key": "" }), "messages");
  await recordStatFor({ DB: db }, reqWith({ "x-kakekomi-test-key": "anything" }), "messages");
  assert.equal(db.calls.length, 2);
});

test("開発用の合言葉（回数制限を外す鍵）の呼び出しも、集計から除く", () => {
  const env = { DB: fakeDb(), DEV_BYPASS_KEY: "dev-5678" };
  assert.equal(isExcludedFromStats(env, reqWith({ "x-kakekomi-dev-key": "dev-5678" })), true);
  assert.equal(isExcludedFromStats(env, reqWith({ "x-kakekomi-dev-key": "nope" })), false);
});

test("集計の除外の印は、回数制限を外さない（別の鍵）", async () => {
  const { isDevBypass } = await import("../src/rateLimit.ts");
  const env = { DB: fakeDb(), STATS_EXCLUDE_KEY: "mark-1234" };
  assert.equal(isDevBypass(env, reqWith({ "x-kakekomi-test-key": "mark-1234" })), false);
});
