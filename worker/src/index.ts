import { extractStatePatch, generateReply, summarizeConsultation } from "./anthropic";
import { buildSystemPrompt, buildCrisisResponse } from "./prompt";
import { selectCandidateActions } from "./rules";
import { recordStat } from "./stats";
import { detectCrisis } from "./safety";
import { markActionsPresented, mergeStatePatch } from "./state";
import { createInitialState } from "./types";
import type { ChatRequestBody, ChatResponseBody, ChatTurn, StructuredState } from "./types";
import { timingSafeEqualStrings } from "./auth";
import { RESOURCES } from "./resources";
import {
  createSession,
  createUser,
  deleteSession,
  resetPasswordWithRecoveryCode,
  ensureAdminUser,
  getUserByToken,
  verifyLogin,
} from "./db";
import {
  checkDailyBudget,
  checkLifetimeCap,
  checkRateLimit,
  isLocked,
  recordFailure,
} from "./rateLimit";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  DEV_BYPASS_KEY?: string;
  DAILY_AI_LIMIT?: string;
  ADMIN_LOGIN_ID?: string;
  ADMIN_PASSWORD?: string;
}

const DEFAULT_DAILY_AI_LIMIT = 300;

function dailyLimit(env: Env): number {
  const n = Number(env.DAILY_AI_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_AI_LIMIT;
}

function dailyLimited(): Response {
  return json(
    { error: "daily_limit", message: "本日のAI利用が上限に達しました。明日またお試しください。" },
    503
  );
}

function rateLimited(): Response {
  return json(
    { error: "rate_limited", message: "しばらく時間をおいてからもう一度お試しください。" },
    429
  );
}

// 画面とAPIは同じWorkerから配信するため、本番では同一オリジンでありCORSは不要。
// 他サイトのJavaScriptからAPIを使われないよう、許可するのは同一オリジンと、
// Worker自体がローカルで動いているとき（開発中）のlocalhost/file:// だけにする。
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const self = new URL(req.url);
  const isLocalWorker = self.hostname === "localhost" || self.hostname === "127.0.0.1";
  const allowed =
    origin === self.origin ||
    (isLocalWorker && (origin === "null" || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-kakekomi-dev-key",
    vary: "origin",
  };
}

function withCors(req: Request, res: Response): Response {
  const extra = corsHeaders(req);
  if (Object.keys(extra).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MESSAGE_MAX = 2000;
const HISTORY_MAX_TURNS = 30;
const HISTORY_ITEM_MAX = 4000;
const STATE_MAX_JSON = 20000;

// クライアントから届く履歴・状態は信用せず、形と大きさを整えてからAIに渡す
// （不正な形式によるエラーや、巨大な入力によるコスト膨張を防ぐ）。
function sanitizeHistory(raw: unknown, maxTurns = HISTORY_MAX_TURNS): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    if (!content.trim()) continue;
    turns.push({ role, content: content.slice(0, HISTORY_ITEM_MAX) });
  }
  const recent = turns.slice(-maxTurns);
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  return recent;
}

function sanitizeState(raw: unknown): StructuredState {
  const s = raw as Partial<StructuredState> | null | undefined;
  const looksValid =
    !!s &&
    typeof s === "object" &&
    !!s.personal &&
    !!s.business &&
    Array.isArray(s.presented_actions) &&
    Array.isArray(s.already_consulted) &&
    JSON.stringify(s).length <= STATE_MAX_JSON;
  return looksValid ? (s as StructuredState) : createInitialState();
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as Partial<ChatRequestBody>;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = sanitizeHistory(body.history);
  const state = sanitizeState(body.state);

  if (!message) {
    return json({ error: "message is required" }, 400);
  }

  // 2章: 緊急性の無条件上書きレイヤー（最優先・キーワードベースで即判定）。
  // AIを呼ばない固定応答なので、回数制限や文字数制限よりも先に必ず判定する。
  if (detectCrisis(message)) {
    await recordStat(env.DB, "crisis");
    const response: ChatResponseBody = {
      reply: buildCrisisResponse(),
      state,
      candidateActions: [],
      safetyTriggered: true,
    };
    return json(response);
  }

  if (message.length > MESSAGE_MAX) {
    return json({ error: "message_too_long" }, 400);
  }
  if (!(await checkRateLimit(env, req, "chat", 30, 3600))) {
    return rateLimited();
  }
  if (!(await checkDailyBudget(env, req, dailyLimit(env)))) {
    return dailyLimited();
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

  await recordStat(env.DB, "messages");
  if (history.length === 0) await recordStat(env.DB, "consultations");

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
  if (!(await checkDailyBudget(env, req, dailyLimit(env)))) {
    return dailyLimited();
  }
  const body = (await req.json()) as { history?: unknown };
  const history = sanitizeHistory(body.history, HISTORY_MAX_TURNS * 2);
  if (history.length === 0) {
    return json({ error: "history_required" }, 400);
  }
  const anthropicEnv = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
  };
  const summary = await summarizeConsultation(anthropicEnv, history);
  await recordStat(env.DB, "summaries");
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
    await recordStat(env.DB, "registrations");
    return json({
      token,
      loginId: user.loginId,
      displayName: user.displayName,
      planStatus: user.planStatus,
      recoveryCode: user.recoveryCode,
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

const RESET_FAIL_LIMIT = 8;
const RESET_FAIL_WINDOW = 3600;

async function handlePasswordReset(req: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit(env, req, "reset", 10, 3600))) {
    return rateLimited();
  }
  const body = (await req.json()) as {
    login_id?: string;
    recovery_code?: string;
    new_password?: string;
  };
  const loginId = (body.login_id ?? "").trim().toLowerCase();
  const recoveryCode = body.recovery_code ?? "";
  const newPassword = body.new_password ?? "";

  const pwError = passwordError(newPassword);
  if (pwError) {
    return json({ error: pwError }, 400);
  }
  if (loginId.length > EMAIL_MAX || recoveryCode.length > 64) {
    return json({ error: "invalid_recovery" }, 401);
  }

  // 同じアカウントへの連続失敗はIPが変わっても止める（コードの総当たり対策）
  const lockKey = `reset_fail:${loginId}`;
  if (await isLocked(env, lockKey, RESET_FAIL_LIMIT)) {
    return json({ error: "reset_locked" }, 429);
  }

  const newCode = await resetPasswordWithRecoveryCode(env.DB, loginId, recoveryCode, newPassword);
  if (!newCode) {
    await recordFailure(env, lockKey, RESET_FAIL_WINDOW);
    return json({ error: "invalid_recovery" }, 401);
  }
  return json({ ok: true, recoveryCode: newCode });
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const token = bearerToken(req);
  if (token) await deleteSession(env.DB, token);
  return json({ ok: true });
}

async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    try {
      if (url.pathname === "/api/chat" && req.method === "POST") {
        return await handleChat(req, env);
      }
      if (url.pathname === "/api/resources" && req.method === "GET") {
        return json({ resources: RESOURCES });
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
      if (url.pathname === "/api/password-reset" && req.method === "POST") {
        return await handlePasswordReset(req, env);
      }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        return await handleLogout(req, env);
      }
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }

    return json({ error: "not_found" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return withCors(req, await route(req, env));
  },
};
