import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCrisis, buildCrisisResponse } from "../src/safety.ts";

const MUST_TRIGGER = [
  "死にたい",
  "もう死にたいです",
  "し にたい",
  "しにたい…",
  "死んでしまいたい",
  "死んだほうがマシ",
  "死んだ方が楽",
  "消えたい",
  "消えてしまいたい",
  "いなくなりたい",
  "この世からいなくなりたい",
  "生きるのがつらい",
  "生きるのが辛い",
  "もう生きていけない",
  "生きていたくない",
  "全部終わりにしたい",
  "楽になりたい",
  "自殺したい",
  "首を吊る",
  "飛び降りようと思う",
  "ｼﾆﾀｲ".normalize("NFKC") + "（半角カナ）",
  "家賃も払えないし、もう死にたい。どうしたらいい？",
];

const MUST_NOT_TRIGGER = [
  "家賃が払えなくて困っています",
  "借金の返済が苦しい",
  "督促状が届いた",
  "死亡保険について知りたい",
  "消費者金融の限度額を教えて",
  "引っ越し費用を安くしたい",
];

for (const text of MUST_TRIGGER) {
  test(`検知する: ${text}`, () => assert.equal(detectCrisis(text), true));
}

for (const text of MUST_NOT_TRIGGER) {
  test(`誤検知しない: ${text}`, () => assert.equal(detectCrisis(text), false));
}

test("危険信号の応答に3つの窓口と「何をしてくれるか」の説明が含まれる", () => {
  const reply = buildCrisisResponse();
  for (const number of ["0120-279-338", "0120-061-338", "0570-783-556"]) {
    assert.ok(reply.includes(number), `${number} がない`);
  }
  assert.ok(reply.includes("話を聞き"), "窓口が何をしてくれるかの説明がない");
  assert.ok(reply.includes("勝手に誰かに知らされたりすることはありません"), "安心材料がない");
});
