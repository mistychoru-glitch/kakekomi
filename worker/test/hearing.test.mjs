import { test } from "node:test";
import assert from "node:assert/strict";
import { planHearing, MAX_LISTENING_USER_TURNS } from "../src/hearing.ts";
import { createInitialState } from "../src/types.ts";
import { buildSystemPrompt } from "../src/prompt.ts";

function st(patch = {}, personal = {}, business = {}) {
  const s = createInitialState();
  Object.assign(s, patch);
  Object.assign(s.personal, personal);
  Object.assign(s.business, business);
  return s;
}

test("話題が分からないうちは、何に困っているかを1つだけ聞く", () => {
  const h = planHearing(st(), 1, "お金のことで困っています");
  assert.equal(h.ready, false);
  assert.equal(h.reason, "topic_unknown");
  assert.match(h.focus, /どんなことで困っている/);
});

test("話題が分かっても、状況が1つしか分からないうちは、次に聞くことを決める", () => {
  const s = st({ category: "personal" }, { sub_category: ["housing"], notice_received: "督促状が届いた" });
  const h = planHearing(s, 1, "家賃を滞納しています");
  assert.equal(h.ready, false);
  assert.match(h.focus, /収入/);
});

test("状況が2つ分かれば、窓口を出してよい", () => {
  const s = st(
    { category: "personal" },
    { sub_category: ["housing"], notice_received: "督促状が届いた", income_type: "会社員、収入は減った" }
  );
  const h = planHearing(s, 2, "はい、残業が減りました");
  assert.equal(h.ready, true);
  assert.equal(h.reason, "enough_facts");
});

test("相談者の3通目では、聞き取りが足りなくても、必ず出す（聞きすぎない）", () => {
  const s = st({ category: "personal" }, { sub_category: ["debt"] });
  assert.equal(planHearing(s, MAX_LISTENING_USER_TURNS - 1, "はい").ready, false);
  const h = planHearing(s, MAX_LISTENING_USER_TURNS, "はい");
  assert.equal(h.ready, true);
  assert.equal(h.reason, "enough_turns");
});

test("差押えや競売、一括返済の請求が来ているときは、すぐに伝える", () => {
  for (const personal of [
    { sub_category: ["mortgage"], mortgage_auction_started: true },
    { sub_category: ["mortgage"], mortgage_acceleration_notified: true },
    { sub_category: ["tax_or_insurance_arrears"], tax_seizure_notice: true },
    { sub_category: ["housing"], legal_proceeding_confirmed: true },
  ]) {
    const h = planHearing(st({ category: "personal" }, personal), 1, "届きました");
    assert.equal(h.ready, true, JSON.stringify(personal));
    assert.equal(h.reason, "urgent");
  }
});

test("窓口を教えてと言われたら、すぐに伝える", () => {
  for (const m of ["どこに相談すればいいですか", "窓口を教えてください", "相談先の電話番号を知りたい"]) {
    assert.equal(planHearing(st(), 1, m).ready, true, m);
  }
  assert.equal(planHearing(st(), 1, "家賃が払えなくて困っています").ready, false);
});

test("すでに次の一歩を出したあと（続きから始めたとき）は、聞き直さない", () => {
  const s = st({ category: "personal", presented_actions: ["mortgage_consult_lender"] }, { sub_category: ["mortgage"] });
  assert.equal(planHearing(s, 1, "続きです").ready, true);
});

test("事業の相談でも、期限と資金を先に聞く", () => {
  const h = planHearing(st({ category: "business" }), 1, "資金繰りが厳しい");
  assert.equal(h.ready, false);
  assert.match(h.focus, /期限/);
});

test("ヒアリング中のプロンプトには、窓口の番号・一覧・候補を入れない", () => {
  const s = st({ category: "personal" }, { sub_category: ["housing"] });
  const h = planHearing(s, 1, "家賃を滞納しています");
  const prompt = buildSystemPrompt(s, [], h);
  assert.match(prompt, /<hearing_mode priority/);
  assert.doesNotMatch(prompt, /<resources>\n相談先を案内するときは/);
  assert.doesNotMatch(prompt, /<candidate_actions>/);
  assert.doesNotMatch(prompt, /0570-078374/); // 法テラス
  assert.match(prompt, /質問を1つだけ/);
});

test("ヒアリングが終わったプロンプトには、窓口の一覧が入る", () => {
  const s = st({ category: "personal" }, { sub_category: ["housing"], notice_received: "督促状", area: "港区" });
  const h = planHearing(s, 2, "はい");
  assert.equal(h.ready, true);
  const prompt = buildSystemPrompt(s, [], h);
  assert.match(prompt, /<resources>\n相談先を案内するときは/);
  assert.doesNotMatch(prompt, /<hearing_mode priority/);
});

test("2通目では、状況が1つ分かっていれば出す（同じことを聞き直さない）", () => {
  const s = st({ category: "personal" }, { sub_category: ["housing"], notice_received: "管理会社から、今月末の期限" });
  assert.equal(planHearing(s, 1, "家賃を滞納しています").ready, false);
  const h = planHearing(s, 2, "管理会社からです");
  assert.equal(h.ready, true);
  assert.equal(h.reason, "enough_facts");
});

test("2通目でも、何も分からないままなら、もう1回だけ聞く", () => {
  const s = st({ category: "personal" }, { sub_category: ["debt"] });
  assert.equal(planHearing(s, 2, "はい").ready, false);
});
