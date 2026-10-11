import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../src/prompt.ts";
import { createInitialState } from "../src/types.ts";

test("気持ちの状態（パニックか等）は、相談者に聞く対象にしない", () => {
  const prompt = buildSystemPrompt(createInitialState(), []);
  const unresolved = prompt.split("<unresolved_points>")[1].split("</unresolved_points>")[0];
  assert.doesNotMatch(unresolved, /心理状態|パニック/);
  assert.match(prompt, /気持ちの状態.*聞かない/);
});

test("候補アクションは、返信の本文で伝える（カードに任せない）", () => {
  const prompt = buildSystemPrompt(createInitialState(), []);
  assert.match(prompt, /先頭の1つを、返信の中で必ず自分の言葉で伝える/);
});
