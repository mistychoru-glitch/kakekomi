import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/types.ts";
import { selectCandidateActions } from "../src/rules.ts";
import { mergeStatePatch } from "../src/state.ts";
import { RESOURCES } from "../src/resources.ts";

function mortgageState(overrides = {}) {
  const s = createInitialState();
  s.category = "personal";
  s.personal.sub_category = ["mortgage"];
  Object.assign(s.personal, overrides);
  return s;
}

test("滞納の初期段階: まず借入先に返済条件の変更を相談する", () => {
  const ids = selectCandidateActions(mortgageState({ mortgage_months_behind: 2 })).map((c) => c.id);
  assert.equal(ids[0], "mortgage_consult_lender");
});

test("一括返済の通知が届いたら、借入先と保証会社への確認と専門家相談が先に出る", () => {
  const ids = selectCandidateActions(mortgageState({ mortgage_acceleration_notified: true })).map((c) => c.id);
  assert.equal(ids[0], "mortgage_acceleration_contact");
  assert.ok(!ids.includes("mortgage_consult_lender"), "通知後に条件変更の相談だけを勧めない");
});

test("競売の手続きが始まっていたら、最優先で法テラス・弁護士に相談する", () => {
  const ids = selectCandidateActions(
    mortgageState({ mortgage_auction_started: true, mortgage_acceleration_notified: true })
  ).map((c) => c.id);
  assert.equal(ids[0], "mortgage_auction_urgent");
});

test("書面の種類が分からないときは、まず種類の確認を出す", () => {
  const ids = selectCandidateActions(mortgageState({ notice_type_unknown: true })).map((c) => c.id);
  assert.equal(ids[0], "mortgage_confirm_notice_type");
});

test("パニック状態では、候補は1つだけに絞られる", () => {
  const s = mortgageState({ mortgage_auction_started: true });
  s.psychological_state = "panic";
  assert.equal(selectCandidateActions(s).length, 1);
});

test("住宅ローンの分類と滞納月数・通知の項目を、検証して取り込む", () => {
  const next = mergeStatePatch(createInitialState(), {
    category: "personal",
    sub_category: ["mortgage", "ふしぎな値"],
    mortgage_months_behind: 6,
    mortgage_acceleration_notified: true,
    mortgage_auction_started: "はい", // 型が違う値は捨てる
  });
  assert.deepEqual(next.personal.sub_category, ["mortgage"]);
  assert.equal(next.personal.mortgage_months_behind, 6);
  assert.equal(next.personal.mortgage_acceleration_notified, true);
  assert.equal(next.personal.mortgage_auction_started, null);
});

test("住宅ローンの窓口: 番号は、公式で確認できた住宅金融支援機構だけ", () => {
  const lender = RESOURCES.find((r) => r.id === "mortgage-lender");
  assert.ok(lender && !lender.phone, "借入先ごとに違う窓口には番号を書かない");
  const jhf = RESOURCES.find((r) => r.id === "jhf-hensai");
  assert.equal(jhf.phone, "0120-0860-16");
  assert.match(jhf.link.url, /^https:\/\/www\.jhf\.go\.jp\//);
});
