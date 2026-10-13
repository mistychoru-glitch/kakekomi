import { test } from "node:test";
import assert from "node:assert/strict";
import { topicNotesFor } from "../src/topics.ts";
import { buildSystemPrompt } from "../src/prompt.ts";
import { createInitialState } from "../src/types.ts";
import { planHearing } from "../src/hearing.ts";
import { ALLOWED_PHONES } from "../src/guard.ts";

test("給料の未払いの言い回しを検出する", () => {
  for (const m of [
    "彼氏の給料が払われていません",
    "給与が2ヶ月支払われていない",
    "バイト代が出ない",
    "未払いの給料について",
    "残業代が未払いです",
  ]) {
    assert.match(topicNotesFor([m]), /wage_arrears/, m);
  }
});

test("関係のない話題では、何も加えない", () => {
  assert.equal(topicNotesFor(["家賃を滞納しています"]), "");
  assert.equal(topicNotesFor(["給料日前でお金がありません"]), "");
});

test("前の発言で話題が分かっていれば、続く質問でも加える", () => {
  assert.match(topicNotesFor(["彼氏の給料が払われていません", "どうなりますか"]), /wage_arrears/);
});

test("見通しの知識は、プロンプトに入り、聞き取り中は入らない", () => {
  const s = createInitialState();
  const ready = planHearing(s, 1, "給料が払われない", true);
  const withNotes = buildSystemPrompt(s, [], ready, topicNotesFor(["給料が払われない"]));
  assert.match(withNotes, /<topic_notes topic="wage_arrears">/);
  assert.match(withNotes, /原則3回以内/);
  const listening = planHearing(s, 1, "お金のことで困っています", false);
  assert.equal(listening.ready, false);
  assert.doesNotMatch(buildSystemPrompt(s, [], listening, topicNotesFor(["お金のことで困っています"])), /<topic_notes topic=/);
});

test("労働の相談窓口の番号は、案内してよい番号に入っている", () => {
  assert.ok(ALLOWED_PHONES.has("0120811610"));
});

test("倒産と給料の組み合わせ・役員の相談も、見通しの知識を加える", () => {
  for (const m of [
    "会社が倒産したら、6月から未払いの給料は支払われなくなりますか",
    "彼氏は会社の執行役員で、給料が払われていません。会社が潰れそうです",
    "会社が破産したら未払いの報酬はどうなる",
  ]) {
    assert.match(topicNotesFor([m]), /wage_arrears/, m);
  }
});

test("見通しの知識に、役員・執行役員の分かれ目と、退職の時期の注意が入っている", () => {
  const notes = topicNotesFor(["給料が払われない"]);
  assert.match(notes, /【役員・執行役員の場合】/);
  assert.match(notes, /肩書きでなく、実態で判断/);
  assert.match(notes, /上限296万円/);
  assert.match(notes, /上限176万円/);
  assert.match(notes, /上限88万円/);
  assert.match(notes, /立て替えた経費/);
  assert.match(notes, /退職の時期（ここは、自分で詳しく説明しない）/);
  assert.match(notes, /退職を遅らせると、対象が広がることは、ない/);
  assert.match(notes, /概算を一緒に計算します/);
  assert.match(notes, /最初の一文で結論/);
});

import { scrubWageTimingClaims, wageGapNotes } from "../src/topics.ts";

test("返信に抜けている大事な点だけを、固定の文で補う", () => {
  const user = ["彼氏は執行役員で、6月から給料が未払い。従業員の給料を20万円立て替えた"];
  const gap = wageGapNotes(user, "結論から言うと、ゼロとは限りません。");
  assert.match(gap, /退職の時期/);
  assert.match(gap, /退職を遅らせて、対象が広がることはありません/);
  assert.match(gap, /立て替えたお金/);
  assert.match(gap, /役員の場合/);
});

test("すでに書かれている点は、重ねて補わない", () => {
  const user = ["執行役員で、6月から給料が未払い。立て替えた分もある"];
  const reply = "退職日の6か月前からの分が対象です。立て替えた分は対象外です。登記簿を確認してください。";
  // 退職の時期は、AIの説明があっても、確かめた固定の文を補う（AIの日付の説明は揺れるため）
  assert.match(wageGapNotes(user, reply), /退職の時期/);
  assert.doesNotMatch(wageGapNotes(user, reply), /立て替えたお金/);
  assert.doesNotMatch(wageGapNotes(user, reply), /役員の場合/);
});

test("給料の未払いの話題でなければ、何も補わない", () => {
  assert.equal(wageGapNotes(["家賃を滞納しています。役員です"], "お話を聞かせてください"), "");
});

test("前の返信に書いてある点は、続く返信で重ねて補わない", () => {
  const user = ["執行役員で、6月から給料が未払い。立て替えた分もある"];
  const prior = ["立て替えた分は対象外です。登記簿を確認してください。\n・退職の時期：退職日が遅くなるほど、対象の範囲は後ろにずれます（退職を遅らせて、対象が広がることはありません）。"];
  assert.equal(wageGapNotes(user, "続きの質問への答えです。", prior), "");
});

test("本番で出た、退職時期の誤った例を取り除く（遅らせると広がる／1月退職で多く対象）", () => {
  const bad =
    "退職日が遅くなるほど、対象の範囲は後ろにずれます。例えば、12月に退職すれば、6月ごろ以降の分が対象に入りますが、1月に退職すれば、古い月からより多く対象になるかもしれません。確認してください。";
  const out = scrubWageTimingClaims(bad);
  assert.doesNotMatch(out, /1月に退職/);
  assert.doesNotMatch(out, /12月に退職/);
  assert.match(out, /退職日が遅くなるほど/);
  assert.match(out, /確認してください/);

  const bad2 = "退職時期を後ろにずらすことで、対象期間を広げられる可能性もあります。証拠を残してください。";
  assert.doesNotMatch(scrubWageTimingClaims(bad2), /広げられる/);
  assert.match(scrubWageTimingClaims(bad2), /証拠を残してください/);

  const bad3 = "今はまだ退職しないで、会社がどう進むかを見守りましょう。証拠を集めてください。";
  assert.doesNotMatch(scrubWageTimingClaims(bad3), /退職しないで/);
});

test("固定の文は、AIが似た言い回しを書いても、そのまま補う（固定の文そのものが無いときは必ず）", () => {
  const user = ["6月から給料が未払い"];
  const reply = "退職日が遅くなるほど、対象の範囲は後ろにずれます。";
  assert.match(wageGapNotes(user, reply), /退職を遅らせて、対象が広がることはありません/);
});
