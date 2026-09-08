// 緊急性の無条件上書きレイヤー（SKILL.md 2章）。
// 最優先・絶対厳守。キーワードベースの検知をコード側で必ず行い、
// LLMの解釈だけに委ねない（システムプロンプト側にも同じ内容を埋め込み、二重化する）。

const CRISIS_KEYWORDS = [
  "死にたい",
  "死のう",
  "消えたい",
  "消えよう",
  "もう終わりにしたい",
  "終わりにしたい",
  "自殺",
  "死ぬ方法",
  "死ぬ手段",
  "首を吊",
  "飛び降り",
  "生きていたくない",
  "生きる意味がない",
  "楽になりたい",
];

export function detectCrisis(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return CRISIS_KEYWORDS.some((kw) => normalized.includes(kw));
}

export const CRISIS_HOTLINES = [
  {
    name: "よりそいホットライン",
    number: "0120-279-338",
    note: "専門の相談員が話を聞き、必要に応じて次の支援先を一緒に考えてくれる窓口です。24時間・無料・匿名可。何かを決めなくても、話すだけでも大丈夫です。",
  },
  {
    name: "#いのちSOS",
    number: "0120-061-338",
    note: "「死にたい」という気持ちをそのまま受け止める窓口です。24時間対応しています。",
  },
  {
    name: "いのちの電話",
    number: "0570-783-556",
    note: "ボランティア相談員が対応します。時間帯は窓口により異なります。",
  },
];

export function buildCrisisResponse(): string {
  const lines = CRISIS_HOTLINES.map(
    (h) => `・${h.name}　${h.number}\n　${h.note}`
  ).join("\n\n");

  return [
    "そんなふうに感じるくらい、今とても苦しい状況にいらっしゃるんですね。話してくださって大丈夫です。",
    "",
    "今は状況の整理よりも先に、話を聞いてくれる場所につながってほしいと思っています。",
    "",
    lines,
    "",
    "電話をかけたからといって、何かを無理に決めさせられたり、勝手に誰かに知らされたりすることはありません。何度でも、いつでもかけて大丈夫です。",
  ].join("\n");
}
