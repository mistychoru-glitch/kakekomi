import { extractStatePatch, generateReply, summarizeConsultation } from "./anthropic";
import { buildSystemPrompt, buildCrisisResponse } from "./prompt";
import { selectCandidateActions } from "./rules";
import { detectCrisis } from "./safety";
import { markActionsPresented, mergeStatePatch } from "./state";
import { createInitialState } from "./types";
import type { ChatRequestBody, ChatResponseBody, ChatTurn } from "./types";
import { timingSafeEqualStrings } from "./auth";
import {
  createSession,
  createUser,
  deleteSession,
  ensureAdminUser,
  getUserByToken,
  verifyLogin,
} from "./db";
import { checkLifetimeCap, checkRateLimit } from "./rateLimit";

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  DEV_BYPASS_KEY?: string;
  ADMIN_LOGIN_ID?: string;
  ADMIN_PASSWORD?: string;
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

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

async function requireAuth(req: Request, env: Env) {
  const token = bearerToken(req);
  if (!token) return null;
  return getUserByToken(env.DB, token);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return "password_too_short";
  if (password.length > PASSWORD_MAX) return "password_too_long";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "password_too_weak";
  return null;
}

function adminLoginId(env: Env): string | null {
  const id = env.ADMIN_LOGIN_ID?.trim().toLowerCase();
  return id && env.ADMIN_PASSWORD ? id : null;
}

async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as {
    login_id?: string;
    display_name?: string;
    password?: string;
  };
  const loginId = (body.login_id ?? "").trim().toLowerCase();
  const displayName = (body.display_name ?? "").trim();
  const password = body.password ?? "";

  if (loginId.length > EMAIL_MAX || !EMAIL_PATTERN.test(loginId)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (loginId === adminLoginId(env)) {
    return json({ error: "login_id_taken" }, 409);
  }
  if (displayName.length < 1 || displayName.length > 50) {
    return json({ error: "display_name_invalid" }, 400);
  }
  const pwError = passwordError(password);
  if (pwError) {
    return json({ error: pwError }, 400);
  }

  // 入力ミスで弾かれた試行は回数に数えない（形式チェックを通ったものだけを制限の対象にする）
  if (!(await checkRateLimit(env, req, "register", 5, 3600))) {
    return rateLimited();
  }
  if (!(await checkLifetimeCap(env, req, "register", 10))) {
    return json(
      { error: "registration_limit_reached", message: "このネットワークからの登録数が上限に達しています。" },
      429
    );
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
  const loginId = (body.login_id ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (loginId.length > EMAIL_MAX || password.length > PASSWORD_MAX) {
    return json({ error: "invalid_credentials" }, 401);
  }

  // 開発者アカウント: ID・パスワードはシークレットで持ち、ソースコードには書かない
  const adminId = adminLoginId(env);
  const user =
    adminId && loginId === adminId
      ? timingSafeEqualStrings(password, env.ADMIN_PASSWORD ?? "")
        ? await ensureAdminUser(env.DB, adminId)
        : null
      : await verifyLogin(env.DB, loginId, password);
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

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const token = bearerToken(req);
  if (token) await deleteSession(env.DB, token);
  return json({ ok: true });
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
      if (url.pathname === "/api/logout" && req.method === "POST") {
        return await handleLogout(req, env);
      }
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }

    return json({ error: "not_found" }, 404);
  },
};
