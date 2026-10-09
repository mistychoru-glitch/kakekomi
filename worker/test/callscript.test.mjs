import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildCallScript, pickTopic } = require("../../frontend/call-script.js");

const RESOURCES = [
  { id: "houterasu", phone: "0570-078374", hours: "平日9:00〜21:00" },
  { id: "jiritsu-soudan" },
  { id: "mortgage-lender" },
  { id: "jfc-jigyo", phone: "0120-154-505" },
];

function state(personal = {}, category = "personal", business = {}) {
  return { category, personal: { sub_category: [], ...personal }, business };
}

test("分類が分からないときは、台本を出さない", () => {
  assert.equal(pickTopic(state()), null);
  assert.equal(buildCallScript(state(), RESOURCES), null);
  assert.equal(buildCallScript(null, RESOURCES), null);
});

test("分類ごとに、電話をかける先が決まる", () => {
  assert.equal(pickTopic(state({ sub_category: ["housing"] })), "housing");
  assert.equal(pickTopic(state({ sub_category: ["mortgage"] })), "mortgage");
  assert.equal(pickTopic(state({ sub_category: ["debt"] })), "debt");
  assert.equal(pickTopic(state({}, "business")), "business");
});

test("住宅ローンは、通知や競売の段階で、かける先が法テラスに変わる", () => {
  assert.equal(pickTopic(state({ sub_category: ["mortgage"], mortgage_acceleration_notified: true })), "mortgage_urgent");
  assert.equal(pickTopic(state({ sub_category: ["mortgage"], mortgage_auction_started: true })), "mortgage_urgent");
});

test("状況の値だけを当てはめる: 分かっていることは入り、分からないことは作らない", () => {
  const s = state({ sub_category: ["housing"], rent_amount: "月18万円", area: "東京都内" });
  const { text } = buildCallScript(s, RESOURCES);
  assert.ok(text.includes("家賃は月18万円です"));
  assert.ok(text.includes("住んでいるのは東京都内です"));
  assert.ok(!text.includes("収入は"), "未回答の収入を作らない");
});

test("電話番号は、確認済みの一覧にあるものだけを使う", () => {
  const withPhone = buildCallScript(state({ sub_category: ["debt"] }), RESOURCES).text;
  assert.ok(withPhone.includes("0570-078374"));
  const noPhone = buildCallScript(state({ sub_category: ["housing"] }), RESOURCES).text;
  assert.ok(!/0\d{1,4}-\d{1,4}-\d{3,4}/.test(noPhone), "自治体ごとの窓口に番号を書かない");
  const emptyList = buildCallScript(state({ sub_category: ["debt"] }), []).text;
  assert.ok(!/0570-078374/.test(emptyList), "一覧にない番号は出さない");
});

test("状況が空でも、台本は成り立つ（話せなくても大丈夫、と伝える）", () => {
  const { text } = buildCallScript(state({ sub_category: ["mortgage"] }), RESOURCES);
  assert.ok(text.includes("【最初の一言】"));
  assert.ok(text.includes("「状況を整理したい」とだけ伝えれば大丈夫です"));
});

test("住宅ローンの滞納月数と通知が、伝えることに入る", () => {
  const { text } = buildCallScript(
    state({ sub_category: ["mortgage"], mortgage_months_behind: 6, mortgage_acceleration_notified: true }),
    RESOURCES
  );
  assert.ok(text.includes("住宅ローンを6か月、滞納しています"));
  assert.ok(text.includes("一括で返すよう求める通知が届いています"));
});
