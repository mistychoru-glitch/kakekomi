import { extractStatePatch, generateReply, summarizeConsultation } from "./anthropic";
import { buildSystemPrompt, buildCrisisResponse } from "./prompt";
import { selectCandidateActions } from "./rules";
import { detectCrisis } from "./safety";
import { markActionsPresented, mergeStatePatch } from "./state";
import { createInitialState } from "./types";
import type { ChatRequestBody, ChatResponseBody, ChatTurn } from "./types";
import { createSession, createUser, getUserByToken, upgradePlan, verifyLogin } from "./db";
import { checkLifetimeCap, checkRateLimit } from "./rateLimit";

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  DEV_BYPASS_KEY?: string;
}

function rateLimited(): Response {
  return json(
    { error: "rate_limited", message: "しばらく時間をおいてからもう一度お試しください。" },
    429
  );
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-kakekomi-dev-key",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit(env, req, "chat", 30, 3600))) {
    return rateLimited();
  }
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

async function handleSummarize(req: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit(env, req, "summarize", 10, 3600))) {
    return rateLimited();
  }
  const body = (await req.json()) as { history?: ChatTurn[] };
  const history = body.history ?? [];
  if (history.length === 0) {
    return json({ error: "history_required" }, 400);
  }
  const anthropicEnv = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
  };
  const summary = await summarizeConsultation(anthropicEnv, history);
  return json({ summary });
}

async function requireAuth(req: Request, env: Env) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  return getUserByToken(env.DB, token);
}

const LOGIN_ID_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

async function handleRegister(req: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit(env, req, "register", 5, 3600))) {
    return rateLimited();
  }
  if (!(await checkLifetimeCap(env, req, "register", 10))) {
    return json(
      { error: "registration_limit_reached", message: "このネットワークからの登録数が上限に達しています。" },
      429
    );
  }
  const body = (await req.json()) as {
    login_id?: string;
    display_name?: string;
    password?: string;
  };
  const loginId = (body.login_id ?? "").trim();
  const displayName = (body.display_name ?? "").trim();
  const password = body.password ?? "";

  if (!LOGIN_ID_PATTERN.test(loginId)) {
    return json({ error: "login_id_invalid" }, 400);
  }
  if (displayName.length < 1 || displayName.length > 50) {
    return json({ error: "display_name_invalid" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "password_too_short" }, 400);
  }

  try {
    const user = await createUser(env.DB, loginId, displayName, password);
    const token = await createSession(env.DB, user.id);
    return json({
      token,
      loginId: user.loginId,
      displayName: user.displayName,
      planStatus: user.planStatus,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "login_id_taken") {
      return json({ error: "login_id_taken" }, 409);
    }
    throw err;
  }
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit(env, req, "login", 15, 3600))) {
    return rateLimited();
  }
  const body = (await req.json()) as { login_id?: string; password?: string };
  const loginId = (body.login_id ?? "").trim();
  const password = body.password ?? "";

  const user = await verifyLogin(env.DB, loginId, password);
  if (!user) {
    return json({ error: "invalid_credentials" }, 401);
  }
  const token = await createSession(env.DB, user.id);
  return json({
    token,
    loginId: user.loginId,
    displayName: user.displayName,
    planStatus: user.planStatus,
  });
}

async function handleMe(req: Request, env: Env): Promise<Response> {
  const user = await requireAuth(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  return json({ loginId: user.loginId, displayName: user.displayName, planStatus: user.planStatus });
}

async function handleUpgrade(req: Request, env: Env): Promise<Response> {
  const user = await requireAuth(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = (await req.json()) as { plan?: string };
  const plan = body.plan === "active" ? "active" : "retain";
  // 注意: 学校提出のMVPにつき実際の決済処理は行わず、プラン状態を直接切り替えるモック。
  await upgradePlan(env.DB, user.id, plan);
  return json({ planStatus: plan });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === "/api/chat" && req.method === "POST") {
        return await handleChat(req, env);
      }
      if (url.pathname === "/api/summarize" && req.method === "POST") {
        return await handleSummarize(req, env);
      }
      if (url.pathname === "/api/register" && req.method === "POST") {
        return await handleRegister(req, env);
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        return await handleLogin(req, env);
      }
      if (url.pathname === "/api/me" && req.method === "GET") {
        return await handleMe(req, env);
      }
      if (url.pathname === "/api/account/upgrade" && req.method === "POST") {
        return await handleUpgrade(req, env);
      }
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }

    return json({ error: "not_found" }, 404);
  },
};
