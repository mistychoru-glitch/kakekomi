import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStatePatch } from "../src/state.ts";
import { RESOURCES, formatResourcesForPrompt } from "../src/resources.ts";

function emptyState() {
  return {
    category: "unclear",
    urgency_level: "unknown",
    psychological_state: "unknown",
    already_consulted: [],
    presented_actions: [],
    personal: {
      sub_category: [], notice_received: null, monthly_income_estimate: null, income_type: null,
      debt_count: null, monthly_repayment_total: null, rent_amount: null, area: null,
      family_composition: null, has_children: null, collection_fear_strong: null,
      already_consulted_no_resolution: null, checked_credit_bureau_total_unclear: null,
      notice_type_unknown: null, legal_proceeding_confirmed: null,
      welfare_rejected_due_to_capacity: null, rent_above_regional_cap_suspected: null,
      cannot_afford_moving_cost: null,
    },
    business: {
      cash_runway: null, critical_deadline: null, debt_types: null, revenue_trend: null,
      employee_count: null, payroll_urgency: null, existing_advisors: null, funding_prospects: null,
    },
  };
}

test("読み取れた項目が反映され、既存の値は消えない", () => {
  let s = mergeStatePatch(emptyState(), { rent_amount: "月20万円", area: "西新宿", category: "personal" });
  s = mergeStatePatch(s, { monthly_income_estimate: "手取り25万円" });
  assert.equal(s.personal.rent_amount, "月20万円");
  assert.equal(s.personal.area, "西新宿");
  assert.equal(s.personal.monthly_income_estimate, "手取り25万円");
  assert.equal(s.category, "personal");
});

test("型や選択肢が不正な値は採用しない", () => {
  const s = mergeStatePatch(emptyState(), {
    category: "hacker",
    urgency_level: 123,
    has_children: "yes",
    debt_count: "3",
    rent_amount: { evil: true },
    area: "   ",
    unknown_key: "x",
    sub_category: ["housing", "bogus", 7],
  });
  assert.equal(s.category, "unclear");
  assert.equal(s.urgency_level, "unknown");
  assert.equal(s.personal.has_children, null);
  assert.equal(s.personal.debt_count, null);
  assert.equal(s.personal.rent_amount, null);
  assert.equal(s.personal.area, null);
  assert.deepEqual(s.personal.sub_category, ["housing"]);
  assert.equal("unknown_key" in s.personal, false);
});

test("長すぎる文字列は切り詰める", () => {
  const s = mergeStatePatch(emptyState(), { notice_received: "あ".repeat(500) });
  assert.equal(s.personal.notice_received.length, 80);
});

test("相談窓口の一覧: 確認済みの番号だけを含み、各窓口に説明がある", () => {
  const phones = RESOURCES.filter((r) => r.phone).map((r) => r.phone).sort();
  // 公式ページで確認できた番号だけ。増やすときは、公式で確認した日と出典をコミットに残すこと。
  // 0120-0860-16: 住宅金融支援機構「ご返済中のお客さま専用ダイヤル」（2026-10-09に公式ページで確認）
  assert.deepEqual(
    phones,
    ["0120-0860-16", "0120-154-505", "0120-279-338", "0570-016811", "0570-078374", "188"].sort()
  );
  for (const r of RESOURCES) {
    assert.ok(r.whatTheyDo.length > 5, `${r.id}: かけると何をしてくれるかの説明がない`);
    if (!r.phone) assert.ok(r.howToFind, `${r.id}: 電話番号がない窓口には探し方が必要`);
  }
  const prompt = formatResourcesForPrompt();
  for (const p of phones) assert.ok(prompt.includes(p));
});
