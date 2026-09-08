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
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: latestMessage },
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
    throw new Error(`Anthropic reply call failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}
