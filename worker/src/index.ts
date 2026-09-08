import { extractStatePatch, generateReply } from "./anthropic";
import { buildSystemPrompt, buildCrisisResponse } from "./prompt";
import { selectCandidateActions } from "./rules";
import { detectCrisis } from "./safety";
import { markActionsPresented, mergeStatePatch } from "./state";
import { createInitialState } from "./types";
import type { ChatRequestBody, ChatResponseBody } from "./types";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as Partial<ChatRequestBody>;
  const message = (body.message ?? "").trim();
  const history = body.history ?? [];
  const state = body.state ?? createInitialState();

  if (!message) {
    return json({ error: "message is required" }, 400);
  }

  // 2章: 緊急性の無条件上書きレイヤー（最優先・キーワードベースで即判定）
  if (detectCrisis(message)) {
    const response: ChatResponseBody = {
      reply: buildCrisisResponse(),
      state,
      candidateActions: [],
      safetyTriggered: true,
    };
    return json(response);
  }

  const anthropicEnv = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
  };

  // 4章: 直近の発言から構造化状態を更新
  const patch = await extractStatePatch(anthropicEnv, state, history, message);
  const updatedState = mergeStatePatch(state, patch);

  // 5章: 優先順位付けロジック（コード側のルールエンジン）
  const candidateActions = selectCandidateActions(updatedState);

  // 7章: システムプロンプトを動的に組み立てて応答生成
  const systemPrompt = buildSystemPrompt(updatedState, candidateActions);
  const reply = await generateReply(anthropicEnv, systemPrompt, history, message);

  const finalState = markActionsPresented(
    updatedState,
    candidateActions.map((a) => a.id)
  );

  const response: ChatResponseBody = {
    reply,
    state: finalState,
    candidateActions,
    safetyTriggered: false,
  };
  return json(response);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      try {
        return await handleChat(req, env);
      } catch (err) {
        console.error(err);
        return json({ error: "internal_error" }, 500);
      }
    }

    return json({ error: "not_found" }, 404);
  },
};
