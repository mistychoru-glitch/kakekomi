import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cf = require("../../frontend/cashflow.js");

const base = { cash: 300, payroll: 250, rent: 50, debt: 40, tax: 30, other: 80, in1: 350, in2: 300, in3: 300 };

test("残高の推移と、足りなくなる時期を、コードで計算する", () => {
  const r = cf.compute(base);
  assert.equal(r.outTotal, 450);
  assert.deepEqual(r.months.map((m) => m.balance), [200, 50, -100]);
  assert.equal(r.severity, "warning");
  assert.equal(r.firstShortageMonth, 3);
  assert.equal(r.shortage, 100);
});

test("来月に足りなくなる場合は、最も重い警告になる", () => {
  const r = cf.compute({ ...base, cash: 50, in1: 200 });
  assert.equal(r.severity, "critical");
  assert.equal(r.nextMonthShortage, 200);
});

test("給与そのものを払えない見込みを見分ける", () => {
  assert.equal(cf.compute({ ...base, cash: 10, in1: 20 }).payrollAtRisk, true);
  assert.equal(cf.compute(base).payrollAtRisk, false);
});

test("3か月は足りる場合は、通常の案内になる", () => {
  const r = cf.compute({ ...base, cash: 900 });
  assert.equal(r.severity, "ok");
  const plan = cf.buildPlan(r, [], [], []);
  assert.equal(plan.steps[0].id, "cashflow_prepare");
});

test("数字が空のときは、空の扱いにして、次の一歩を作らない", () => {
  const r = cf.compute({});
  assert.equal(r.severity, "empty");
  assert.equal(cf.buildPlan(r, [], [], []).steps.length, 0);
});

test("不正な値（文字・マイナス）は0として扱う", () => {
  const r = cf.compute({ ...base, cash: "あ", payroll: -5, in1: "abc" });
  assert.equal(r.cash, 0);
  assert.equal(r.out.payroll, 0);
});

test("売掛金は、遅れが多い順、同じなら金額が大きい順", () => {
  const ranked = cf.rankReceivables([
    { name: "A", amount: 100, lateDays: 0 },
    { name: "B", amount: 50, lateDays: 30 },
    { name: "C", amount: 200, lateDays: 0 },
    { name: "D", amount: 0, lateDays: 99 },
  ]);
  assert.deepEqual(ranked.map((r) => r.name), ["B", "C", "A"]);
});

const pays = [
  { name: "建材店", amount: 80, dueDays: 5, kind: "supplier", rel: "good", impact: "replaceable" },
  { name: "外注先", amount: 60, dueDays: 20, kind: "supplier", rel: "normal", impact: "critical" },
  { name: "大家", amount: 50, dueDays: 3, kind: "rent", rel: "hard", impact: "critical" },
  { name: "X銀行", amount: 40, dueDays: 10, kind: "loan" },
  { name: "税務署", amount: 30, dueDays: 15, kind: "tax" },
  { name: "従業員", amount: 250, dueDays: 20, kind: "payroll" },
];

test("猶予の相談先: 大きい・近い・相談しやすい・代わりがある相手が先に来る", () => {
  const r = cf.compute({ ...base, cash: 120, in1: 300, in2: 300, in3: 300 });
  const d = cf.rankPayables(pays, r);
  assert.equal(d.ranked[0].name, "建材店");
  assert.ok(d.ranked[0].reasons.includes("相談しやすい"));
});

test("給与・税金・借入の返済は、取引先への猶予の対象にしない（専用の相談先へ回す）", () => {
  const d = cf.rankPayables(pays, cf.compute(base));
  assert.ok(d.ranked.every((r) => !["loan", "tax", "payroll"].includes(r.kind)));
  assert.deepEqual(d.routed.map((r) => r.name).sort(), ["X銀行", "従業員", "税務署"].sort());
});

test("止まると事業が回らない相手には、全額ではなく一部・分割で、と注意を添える", () => {
  const d = cf.rankPayables(pays, cf.compute(base));
  const critical = d.ranked.find((r) => r.name === "外注先");
  assert.match(critical.caution, /一部や分割/);
});

test("不足額に届くまで、上位から何件で足りるかを出す。届かないときは、その旨を伝える", () => {
  const r = cf.compute({ ...base, cash: 120, in1: 300 }); // 来月の不足あり
  const d = cf.rankPayables(pays, r);
  assert.equal(d.coverage.enough, true);
  const tiny = cf.rankPayables([{ name: "小", amount: 1, kind: "supplier", dueDays: 5 }], r);
  assert.equal(tiny.coverage.enough, false);
  const plan = cf.buildPlan(r, [], [], [{ name: "小", amount: 1, kind: "supplier", dueDays: 5 }]);
  const step = plan.steps.find((s) => s.id === "cashflow_defer_priority");
  assert.match(step.caveat, /届きません/);
});

test("取引先名を伏せる呼び名で、次の一歩を作れる（本名が混ざらない）", () => {
  const r = cf.compute({ ...base, cash: 120, in1: 300 });
  const plan = cf.buildPlan(r, [{ name: "秘密商事", amount: 100, lateDays: 5 }], [], pays, {
    nameOf: (kind, item) => cf.labelOf(kind, item.idx),
  });
  const text = plan.steps.map((s) => s.action + s.caveat).join("");
  assert.ok(!text.includes("秘密商事") && !text.includes("建材店"));
  assert.ok(text.includes("売掛先A") && text.includes("支払先A"));
});

test("電話番号は、確認済みの一覧にあるものだけを使う", () => {
  const r = cf.compute({ ...base, cash: 50, in1: 200 });
  const withPhone = cf.buildPlan(r, [], [{ id: "jfc-jigyo", phone: "0120-154-505" }], []);
  assert.ok(withPhone.steps.some((s) => s.action.includes("0120-154-505")));
  const without = cf.buildPlan(r, [], [], []);
  assert.ok(!without.steps.some((s) => /0\d{1,4}-\d{1,4}-\d{3,4}/.test(s.action)));
});

test("貼り付け: タブ・カンマ・引用符・見出し・円と万円の単位に対応する", () => {
  const recv = cf.parsePasted('取引先名,金額,遅れの日数\n"A商事, 本社","1,200,000",20\nB社,300000,0', "recv", "yen");
  assert.deepEqual(recv.rows.map((r) => [r.name, r.amount, r.lateDays]), [["A商事, 本社", 120, 20], ["B社", 30, 0]]);
  const pay = cf.parsePasted("種類,支払先,金額,期日まで\n仕入,建材店,800000,5\n家賃,大家,500000,3", "pay", "yen");
  assert.deepEqual(pay.rows.map((r) => [r.name, r.amount, r.dueDays, r.kind]), [["建材店", 80, 5, "supplier"], ["大家", 50, 3, "rent"]]);
  assert.equal(cf.parsePasted("A\t12\t3", "recv", "man").rows[0].amount, 12);
});

test("貼り付け: 件数の上限を超えた分は取り込まず、その数を返す", () => {
  const lines = Array.from({ length: 25 }, (_, i) => `社${i}\t10\t0`).join("\n");
  const r = cf.parsePasted(lines, "recv", "man");
  assert.equal(r.rows.length, cf.MAX_IMPORT);
  assert.equal(r.ignored, 5);
});

test("CSVの文字コード: UTF-8（BOMつき）も Shift_JIS も読める", () => {
  assert.equal(cf.decodeText(new Uint8Array([0x8b, 0xe0, 0x8a, 0x7a]).buffer), "金額");
  assert.equal(cf.decodeText(new TextEncoder().encode("﻿金額").buffer), "金額");
});

test("計算・取り込みのコードは、通信も保存もしない（数字と取引先名を外に出さない）", () => {
  const source = readFileSync(new URL("../../frontend/cashflow.js", import.meta.url), "utf8");
  for (const word of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "localStorage", "sessionStorage", "indexedDB"]) {
    assert.ok(!source.includes(word), `cashflow.js に ${word} が入っている`);
  }
});

test("資金繰りチェックの画面は、入力内容を送る通信をしない", () => {
  const app = readFileSync(new URL("../../frontend/app.js", import.meta.url), "utf8");
  const i = app.indexOf("// ---- 資金繰りチェック（経営者向け） ----");
  const j = app.indexOf("// ---- 初期化 ----");
  const section = app.slice(i, j);
  assert.ok(i > 0 && j > i);
  assert.ok(!section.includes("fetch("), "資金繰りチェックの部分に fetch がある");
  assert.ok(!section.includes("sendMessage("), "取引先の内容を、そのままAIに送る呼び出しがある");
});
