import { test } from "node:test";
import assert from "node:assert/strict";
import { jstDay, recordStat } from "../src/stats.ts";

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
