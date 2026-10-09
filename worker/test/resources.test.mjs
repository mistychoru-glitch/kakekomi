import { test } from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, formatResourcesForPrompt } from "../src/resources.ts";
import { readFileSync } from "node:fs";

test("自治体ごとに違う窓口には電話番号を載せず、https の公式リンクだけを持たせる", () => {
  const local = RESOURCES.find((r) => r.id === "jiritsu-soudan");
  assert.ok(local, "自立相談支援機関の項目がある");
  assert.equal(local.phone, undefined, "自治体ごとの窓口に番号を書かない");
  assert.ok(local.howToFind && local.howToFind.includes("福祉"), "探し方を案内している");
  assert.match(local.link.url, /^https:\/\//);
});

test("リンクを持つ項目は、すべて https で、ラベルがある", () => {
  for (const r of RESOURCES) {
    if (!r.link) continue;
    assert.match(r.link.url, /^https:\/\//, `${r.id} の URL`);
    assert.ok(r.link.label.length > 0, `${r.id} のラベル`);
  }
});

test("AIへの指示に、地域の窓口の電話番号を書かない規則が入っている", () => {
  const promptSource = readFileSync(new URL("../src/prompt.ts", import.meta.url), "utf8");
  assert.ok(promptSource.includes("その窓口の電話番号は決して書かない"));
  assert.ok(formatResourcesForPrompt().includes("探し方:"));
});
