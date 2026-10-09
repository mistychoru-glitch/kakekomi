// プロンプトインジェクションなどへの防御（入力の検査と、出力の検査）。
// 完全に防げる仕組みではないので、「AIへの指示」だけに頼らず、コード側でも検査して、層で守る。

import { CRISIS_HOTLINES } from "./safety.ts";
import { RESOURCES } from "./resources.ts";

// システムプロンプトに入れる目印。AIの返信に出てきたら、システムプロンプトが漏れている。
export const CANARY = "KKM-CANARY-7c2e91f4";

// システムプロンプトの構造を表すタグ。相談者の入力に混ぜて、構造を壊されないようにする。
const STRUCTURE_TAGS =
  /<\s*\/?\s*(role|tone_guidelines|scope_guard|safety_override|current_state|candidate_actions|resources|unresolved_points|response_instructions|security|system|assistant|user|instructions?)\b/gi;

// 見えない文字や、全角・半角のゆれで、検査をすり抜けられないようにそろえる
function normalizeForGuard(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‏⁠﻿­]/g, "")
    .replace(/\s+/g, " ");
}

// 構造を壊すタグは、全角の記号にして、タグとして働かないようにする
export function neutralizeTags(text: string): string {
  return text.replace(STRUCTURE_TAGS, (m) => m.replace("<", "＜"));
}

// 「指示を無視して」「システムプロンプトを教えて」など、はっきりした攻撃の言い回しだけを対象にする。
// 普通のお金の相談を誤って止めないよう、ゆるい言い回しは対象にしない。
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the |your )?(previous|prior|above|earlier|preceding) (instructions?|prompts?|rules?|messages?|context)/,
  /disregard (all |any |the |your )?(previous|prior|above|earlier)? ?(instructions?|prompts?|rules?)/,
  /(reveal|show|print|repeat|output|display|leak|tell me)( me)? (your |the )?(system |initial |hidden |original )?(prompt|instructions?)/,
  /(you are|act as|pretend to be|from now on you are) (now )?(dan|an? unrestricted|an? uncensored|in developer mode)/,
  /\b(jailbreak|dan mode|developer mode|do anything now)\b/,
  /(以前|これまで|上記|前|先ほど|さっき|今まで)(の|まで)? ?(指示|命令|ルール|プロンプト|設定|制約)[^。\n]{0,12}(無視|忘れ|破棄|従わ|解除)/,
  /(指示|命令|ルール|制約|制限|設定)を?[^。\n]{0,6}(すべて|全て|全部)? ?(無視|忘れ|解除|破棄)(して|しろ|せよ|しなさい|ください)/,
  /(システム|初期|隠し|内部)(プロンプト|指示|設定|命令)[^。\n]{0,14}(教え|表示|出力|見せ|開示|書き出|コピー|繰り返|翻訳)/,
  /(あなた|君|お前)の?(指示|プロンプト|設定|ルール)[^。\n]{0,10}(教え|表示|出力|見せ|開示)/,
  /(開発者|デベロッパー|管理者)(モード|権限)/,
  /脱獄|ジェイルブレイク/,
];

export function looksLikeInjection(text: string): boolean {
  const t = normalizeForGuard(text);
  return INJECTION_PATTERNS.some((p) => p.test(t));
}

export const INJECTION_REPLY =
  "ここでは、お金のご相談をお伺いしています。いま困っていることや、気になっていることを、そのまま書いてください。";

export const LEAK_REPLY =
  "申し訳ありません。その内容にはお答えできません。お金のことで困っていることを、そのまま書いてください。";

// ---- AIの返信の検査 ----

function digitsOnly(s: string): string {
  return s.normalize("NFKC").replace(/\D/g, "");
}

// 案内してよい電話番号: 確認済みの窓口の一覧と、危険信号のときの窓口だけ
const ALLOWED_PHONES = new Set<string>(
  [...RESOURCES.map((r) => r.phone), ...CRISIS_HOTLINES.map((h) => h.number)]
    .filter((p): p is string => !!p)
    .map(digitsOnly)
);

// 案内してよいリンクのドメイン: 確認済みの窓口の公式ページだけ
const ALLOWED_HOSTS = new Set<string>(
  RESOURCES.map((r) => r.link?.url)
    .filter((u): u is string => !!u)
    .map((u) => new URL(u).hostname)
);

// 全角の数字（０３－１２３４…）でも検査をすり抜けられないよう、数字は全角も対象にする
const D = "[0-9０-９]";
const SEP = "[-‐‑–−－ー\\s]?";
const PHONE_LIKE = new RegExp(
  `(?<!${D})(?:[+＋]?[8８][1１]${SEP}|[0０])${D}{1,4}${SEP}${D}{1,4}${SEP}${D}{3,4}(?!${D})`,
  "g"
);
const URL_LIKE = /https?:\/\/[^\s　)）」』<>"']+/gi;

const LEAK_MARKERS = [
  CANARY.toLowerCase(),
  "<safety_override",
  "<scope_guard",
  "<response_instructions",
  "<current_state",
  "<candidate_actions",
  "</security",
  "<security",
];

export function sanitizeReply(reply: string): { text: string; changed: boolean; leaked: boolean } {
  const lower = reply.toLowerCase();
  if (LEAK_MARKERS.some((m) => lower.includes(m))) {
    return { text: LEAK_REPLY, changed: true, leaked: true };
  }

  let changed = false;
  let text = reply.replace(PHONE_LIKE, (m) => {
    const d = digitsOnly(m);
    // 年月日や金額に見える短い数字（例: 0.5）は対象外。電話番号の長さのものだけ調べる
    if (d.length < 9 || d.length > 13) return m;
    if (ALLOWED_PHONES.has(d)) return m;
    changed = true;
    return "（番号は省略しました）";
  });

  text = text.replace(URL_LIKE, (m) => {
    try {
      const host = new URL(m).hostname;
      if (ALLOWED_HOSTS.has(host)) return m;
    } catch {
      /* 読み取れないリンクは省略する */
    }
    changed = true;
    return "（リンクは省略しました）";
  });

  if (changed) {
    text += "\n\n※電話番号やリンクは、窓口の公式の案内で、必ず確認してください。";
  }
  return { text, changed, leaked: false };
}
