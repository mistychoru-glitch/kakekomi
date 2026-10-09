import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createInitialState } from "../src/types.ts";
import { selectCandidateActions } from "../src/rules.ts";
import { mergeStatePatch } from "../src/state.ts";
import { RESOURCES } from "../src/resources.ts";

const require = createRequire(import.meta.url);
const { buildCallScript, pickTopic } = require("../../frontend/call-script.js");

function taxState(personal = {}, category = "personal") {
  const s = createInitialState();
  s.category = category;
  s.personal.sub_category = ["tax_or_insurance_arrears"];
  Object.assign(s.personal, personal);
  return s;
}

const ids = (s) => selectCandidateActions(s).map((c) => c.id);

test("差押えの予告が届いたら、最優先で送り主に連絡して分割・猶予を相談する", () => {
  assert.equal(ids(taxState({ tax_seizure_notice: true, arrears_local_tax: true }))[0], "tax_seizure_contact_now");
});

test("書面の種類が分からないときは、まず種類と送り主を確認する", () => {
  assert.equal(ids(taxState({ notice_type_unknown: true }))[0], "tax_confirm_notice_type");
});

test("滞納の種類ごとに、窓口が変わる", () => {
  assert.ok(ids(taxState({ arrears_national_tax: true })).includes("tax_national_consult"));
  assert.ok(ids(taxState({ arrears_local_tax: true })).includes("tax_local_consult"));
  assert.ok(ids(taxState({ arrears_health_insurance: true })).includes("tax_health_insurance_consult"));
  assert.ok(ids(taxState({ arrears_pension: true })).includes("tax_pension_exemption"));
});

test("種類が分からないときは、書面の送り主の窓口に相談する、が出る", () => {
  assert.ok(ids(taxState()).includes("tax_consult_office"));
});

test("パニック状態では、候補は1つに絞られる", () => {
  const s = taxState({ tax_seizure_notice: true });
  s.psychological_state = "panic";
  assert.equal(selectCandidateActions(s).length, 1);
});

test("事業の相談でも、税の滞納があれば、同じ窓口の候補が出る", () => {
  const s = createInitialState();
  s.category = "business";
  s.personal.arrears_national_tax = true;
  assert.ok(ids(s).includes("tax_national_consult"));
});

test("AIの抽出結果から、滞納の種類を検証して取り込む", () => {
  const next = mergeStatePatch(createInitialState(), {
    category: "personal",
    sub_category: ["tax_or_insurance_arrears"],
    arrears_local_tax: true,
    arrears_health_insurance: true,
    tax_seizure_notice: "あり", // 型が違う値は捨てる
  });
  assert.equal(next.personal.arrears_local_tax, true);
  assert.equal(next.personal.arrears_health_insurance, true);
  assert.equal(next.personal.tax_seizure_notice, null);
});

test("窓口の一覧: 税・年金の窓口は、番号を書かず、探し方と公式リンクを持つ", () => {
  for (const id of ["tax-national", "tax-local-insurance", "nenkin-menjo"]) {
    const r = RESOURCES.find((x) => x.id === id);
    assert.ok(r, `${id} がある`);
    assert.equal(r.phone, undefined, `${id}: 番号は書かない`);
    assert.ok(r.howToFind && r.whatTheyDo.length > 10);
  }
  assert.match(RESOURCES.find((x) => x.id === "tax-national").link.url, /^https:\/\/www\.nta\.go\.jp\//);
  assert.match(RESOURCES.find((x) => x.id === "nenkin-menjo").link.url, /^https:\/\/www\.nenkin\.go\.jp\//);
});

test("電話の台本: 滞納している種類ごとにかける先が変わり、番号は書かない", () => {
  const st = taxState({ arrears_local_tax: true, arrears_pension: true, notice_received: "督促状" });
  assert.equal(pickTopic(st), "tax");
  const { text } = buildCallScript(st, RESOURCES);
  assert.ok(text.includes("市区町村の税の窓口"));
  assert.ok(text.includes("年金事務所"));
  assert.ok(!text.includes("税務署（徴収担当）"), "滞納していない国税の窓口は出さない");
  assert.ok(!/0\d{1,4}-\d{1,4}-\d{3,4}/.test(text));
  assert.ok(text.includes("滞納しているのは、住民税などの地方税、国民年金保険料です"));
});

test("電話の台本: 差押えの通知が来ていれば、他の分類より税の台本を優先する", () => {
  const st = taxState({ tax_seizure_notice: true });
  st.personal.sub_category = ["housing", "tax_or_insurance_arrears"];
  assert.equal(pickTopic(st), "tax");
});

test("電話の台本: 差押えの記載が書面の説明に入っているときは、同じ内容を2回書かない", () => {
  const st = taxState({ tax_seizure_notice: true, notice_received: "市役所から差押えの予告" });
  const { text } = buildCallScript(st, RESOURCES);
  assert.equal(text.split("差押え").length - 1 >= 1, true);
  assert.ok(!text.includes("差押えの予告、または差押えの通知が来ています"));
});
