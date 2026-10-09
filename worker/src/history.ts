// ブラウザから届く会話の履歴を、AIに渡す前に検査する。
// - AIの発言は、サーバーが出したものか、署名で確かめる（偽のAI発言を混ぜる攻撃を防ぐ）
// - 相談者の発言は、命令の言い回しを含むものは使わず、指示の構造を壊すタグは無効にする
// - 長さと件数に上限をつけ、巨大な入力による費用の膨張を防ぐ

import { ALLOWED_PHONES, looksLikeInjection, neutralizeTags } from "./guard.ts";
import { maskPersonalInfo } from "./mask.ts";
import { verifyText } from "./sign.ts";
import type { ChatTurn } from "./types.ts";

export const HISTORY_MAX_TURNS = 30;
export const HISTORY_ITEM_MAX = 4000;
export const HISTORY_TOTAL_MAX = 40000;

export async function sanitizeHistory(
  signingKey: string | undefined,
  raw: unknown,
  maxTurns = HISTORY_MAX_TURNS
): Promise<ChatTurn[]> {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw.slice(-maxTurns * 2)) {
    if (!item || typeof item !== "object") continue;
    const { role, content, sig } = item as { role?: unknown; content?: unknown; sig?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    if (!content.trim()) continue;
    if (role === "assistant") {
      if (!(await verifyText(signingKey, content, sig))) continue;
      turns.push({ role, content: content.slice(0, HISTORY_ITEM_MAX) });
    } else {
      const text = content.slice(0, HISTORY_ITEM_MAX);
      if (looksLikeInjection(text)) continue;
      // AIに送る前に、個人情報に見える部分を伏せる（画面側でも伏せているが、二重の守り）
      // 伏せ字は、文字の正規化（全角→半角）をするので、タグの無効化は、そのあとにする
      turns.push({ role, content: neutralizeTags(maskPersonalInfo(text, ALLOWED_PHONES).text) });
    }
  }
  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (turns.length > 0 && total > HISTORY_TOTAL_MAX) {
    total -= turns[0].content.length;
    turns.shift();
  }
  const recent = turns.slice(-maxTurns);
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  return recent;
}
