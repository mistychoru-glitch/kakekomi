import type { ChatTurn, StructuredState } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicEnv {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
}

// 構造化状態の更新のみを担当するツール定義（SKILL.md 4章の項目に対応）。
// LLMには「判断ロジック」ではなく「発言からの読み取り」だけを担わせる。
const STATE_EXTRACTION_TOOL = {
  name: "update_structured_state",
  description:
    "直近のユーザー発言から読み取れる範囲だけ、構造化状態の差分を返す。読み取れない項目はキー自体を含めない。断定できない場合は無理に埋めない。",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["personal", "business", "unclear"] },
      urgency_level: {
        type: "string",
        enum: ["crisis", "urgent", "steady", "unknown"],
      },
      psychological_state: {
        type: "string",
        enum: ["panic", "anxious", "calm", "unknown"],
      },
      sub_category: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "debt",
            "housing",
            "income_loss",
            "tax_or_insurance_arrears",
            "other",
          ],
        },
      },
      has_children: { type: "boolean" },
      debt_count: { type: "integer" },
      notice_type_unknown: { type: "boolean" },
      legal_proceeding_confirmed: { type: "boolean" },
      welfare_rejected_due_to_capacity: { type: "boolean" },
      rent_above_regional_cap_suspected: { type: "boolean" },
      cannot_afford_moving_cost: { type: "boolean" },
      collection_fear_strong: { type: "boolean" },
      already_consulted_no_resolution: { type: "boolean" },
      checked_credit_bureau_total_unclear: { type: "boolean" },
      payroll_urgency: { type: "boolean" },
      existing_advisors: { type: "string" },
    },
  },
};

type ExtractionPatch = Record<string, unknown>;

export async function extractStatePatch(
  env: AnthropicEnv,
  state: StructuredState,
  history: ChatTurn[],
  latestMessage: string
): Promise<ExtractionPatch> {
  const recentHistory = history.slice(-6);
  const body = {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 512,
    system:
      "あなたは会話ログから構造化状態の差分だけを抽出するアシスタントです。推測で断定せず、発言から読み取れる範囲のみ update_structured_state ツールを呼び出してください。",
    messages: [
      ...recentHistory.map((t) => ({ role: t.role, content: t.content })),
      {
        role: "user" as const,
        content: `現在の状態: ${JSON.stringify(
          state
        )}\n\n直近の発言: ${latestMessage}`,
      },
    ],
    tools: [STATE_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "update_structured_state" },
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Anthropic extraction call failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; input?: ExtractionPatch }>;
  };
  const toolUse = data.content.find((c) => c.type === "tool_use");
  return toolUse?.input ?? {};
}

export async function generateReply(
  env: AnthropicEnv,
  systemPrompt: string,
  history: ChatTurn[],
  latestMessage: string
): Promise<string> {
  const body = {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: latestMessage },
    ],
    // 家賃相場・自治体の制度等、最新かつ具体的な情報が必要な場合にAI自身の判断で
    // 使わせるWeb検索ツール（SKILL.md 6章）。使いすぎないよう上限を設ける。
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Anthropic reply call failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  return stripMarkdown(text);
}

// チャットUIはMarkdownを解釈せずプレーンテキストとして表示するため、
// 指示を守らずモデルが記法を混ぜてきた場合に備えて念のため除去する。
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "・");
}

const SUMMARY_SYSTEM_PROMPT = `あなたは、相談者とAIカウンセラーとのこれまでの会話を、外部の専門家（弁護士・自立相談支援機関・福祉事務所・家族等）に共有するための要約に変換するアシスタントです。

以下のルールに従ってください：
- 相談者本人の一人称ではなく「相談者は」という三人称の客観的な文章にする
- 箇条書きではなく、自然な文章で2〜4段落程度にまとめる
- 会話に含まれる事実（状況・経緯・希望・すでに検討した選択肢等）を漏らさず、簡潔に整理する
- 診断や断定はせず、会話で語られたことの範囲にとどめる
- 感情表現も、状況理解に必要な範囲で客観的に触れてよい（過度に感傷的な言い回しは避ける）
- Markdown記法は使わず、プレーンテキストのみで出力する`;

export async function summarizeConsultation(
  env: AnthropicEnv,
  history: ChatTurn[]
): Promise<string> {
  const transcript = history
    .map((t) => `${t.role === "user" ? "相談者" : "カウンセラー"}: ${t.content}`)
    .join("\n\n");

  const body = {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user" as const,
        content: `以下の会話を要約してください。\n\n${transcript}`,
      },
    ],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Anthropic summarize call failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  return stripMarkdown(text);
}
