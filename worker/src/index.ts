import { extractStatePatch, generateReply, summarizeConsultation } from "./anthropic";
import { buildSystemPrompt, buildCrisisResponse } from "./prompt";
import { selectCandidateActions } from "./rules";
import { recordStat } from "./stats";
import { detectCrisis } from "./safety";
import { markActionsPresented, mergeStatePatch, sanitizeClientState } from "./state";
import { INJECTION_REPLY, looksLikeInjection, neutralizeTags, sanitizeReply } from "./guard";
import { sanitizeHistory } from "./history";
import { signText } from "./sign";
import { isCommonPassword } from "./passwords";
import type { ChatRequestBody, ChatResponseBody } from "./types";
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
  CHAT_SIGNING_KEY?: string; // AIの返信の署名に使う鍵（会話の履歴への、偽のAI発言の混入を防ぐ）
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 相談の内容や状態が入るので、ブラウザや途中の中継にキャッシュさせない
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// 大きすぎる入力で、メモリや費用を使い切られないよう、受け取る大きさに上限をつける。
class HttpError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code);
  }
}

const AUTH_BODY_MAX = 8 * 1024;
const CHAT_BODY_MAX = 600 * 1024;

async function readJson<T>(req: Request, maxBytes: number): Promise<T> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "payload_too_large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large");
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

const MESSAGE_MAX = 2000;
const HISTORY_MAX_TURNS = 30;

async function handleChat(req: Request, env: Env): Promise<Response> {
  const body = await readJson<Partial<ChatRequestBody>>(req, CHAT_BODY_MAX);
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  // 状態は、そのまま信用せず、項目ごとに検証して作り直す（AIへの指示に入る値なので）
  const state = sanitizeClientState(body.state);
  const isFirstMessage = !Array.isArray(body.history) || body.history.length === 0;

  if (!rawMessage) {
    return json({ error: "message is required" }, 400);
  }

  // 2章: 緊急性の無条件上書きレイヤー（最優先・キーワードベースで即判定）。
  // AIを呼ばない固定応答なので、回数制限や文字数制限よりも先に必ず判定する。
  if (detectCrisis(rawMessage)) {
    await recordStat(env.DB, "crisis");
    const reply = buildCrisisResponse();
    const response: ChatResponseBody = {
      reply,
      sig: await signText(env.CHAT_SIGNING_KEY, reply),
      state,
      candidateActions: [],
      safetyTriggered: true,
    };
    return json(response);
  }

  if (rawMessage.length > MESSAGE_MAX) {
    return json({ error: "message_too_long" }, 400);
  }
  if (!(await checkRateLimit(env, req, "chat", 30, 3600))) {
    return rateLimited();
  }

  // 「指示を無視して」「システムプロンプトを教えて」などの、はっきりした攻撃の言い回しは、
  // AIを呼ばずに、固定の返信で断る（費用もかからず、AIが影響を受けることもない）。
  if (looksLikeInjection(rawMessage)) {
    await recordStat(env.DB, "blocked");
    const response: ChatResponseBody = {
      reply: INJECTION_REPLY,
      sig: await signText(env.CHAT_SIGNING_KEY, INJECTION_REPLY),
      state,
      candidateActions: [],
      safetyTriggered: false,
    };
    return json(response);
  }

  if (!(await checkDailyBudget(env, req, dailyLimit(env)))) {
    return dailyLimited();
  }

  const history = await sanitizeHistory(env.CHAT_SIGNING_KEY, body.history);
  const message = neutralizeTags(rawMessage);

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
  const rawReply = await generateReply(anthropicEnv, systemPrompt, history, message);

  // AIの返信も、そのまま信用しない。確認済みでない電話番号やリンク、システムプロンプトの漏れを取り除く
  const checked = sanitizeReply(rawReply);
  if (checked.changed) await recordStat(env.DB, checked.leaked ? "leak_blocked" : "reply_filtered");

  const finalState = markActionsPresented(
    updatedState,
    candidateActions.map((a) => a.id)
  );

  await recordStat(env.DB, "messages");
  if (isFirstMessage) await recordStat(env.DB, "consultations");

  const response: ChatResponseBody = {
    reply: checked.text,
    sig: await signText(env.CHAT_SIGNING_KEY, checked.text),
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
  const body = await readJson<{ history?: unknown }>(req, CHAT_BODY_MAX);
  const history = await sanitizeHistory(env.CHAT_SIGNING_KEY, body.history, HISTORY_MAX_TURNS * 2);
  if (history.length === 0) {
    return json({ error: "history_required" }, 400);
  }
  const anthropicEnv = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
  };
  const summary = sanitizeReply(await summarizeConsultation(anthropicEnv, history)).text;
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

function passwordError(password: string, loginId = ""): string | null {
  if (password.length < PASSWORD_MIN) return "password_too_short";
  if (password.length > PASSWORD_MAX) return "password_too_long";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "password_too_weak";
  if (isCommonPassword(password, loginId)) return "password_common";
  return null;
}

function adminLoginId(env: Env): string | null {
  const id = env.ADMIN_LOGIN_ID?.trim().toLowerCase();
  return id && env.ADMIN_PASSWORD ? id : null;
}

async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    login_id?: string;
    display_name?: string;
    password?: string;
  }>(req, AUTH_BODY_MAX);
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
  const pwError = passwordError(password, loginId);
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
  const body = await readJson<{ login_id?: string; password?: string }>(req, AUTH_BODY_MAX);
  const loginId = (body.login_id ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (loginId.length > EMAIL_MAX || password.length > PASSWORD_MAX) {
    return json({ error: "invalid_credentials" }, 401);
  }

  // 同じアカウントへの連続失敗は、IPが変わっても止める（複数のIPからの総当たり対策）。
  // 存在するIDかどうかに関わらず、同じように数える（ロックの有無から、IDの有無を探られないため）。
  const lockKey = `login_fail:${loginId}`;
  if (await isLocked(env, lockKey, LOGIN_FAIL_LIMIT)) {
    return json({ error: "login_locked" }, 429);
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
    await recordFailure(env, lockKey, LOGIN_FAIL_WINDOW);
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

const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW = 3600;
const RESET_FAIL_LIMIT = 8;
const RESET_FAIL_WINDOW = 3600;

async function handlePasswordReset(req: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit(env, req, "reset", 10, 3600))) {
    return rateLimited();
  }
  const body = await readJson<{
    login_id?: string;
    recovery_code?: string;
    new_password?: string;
  }>(req, AUTH_BODY_MAX);
  const loginId = (body.login_id ?? "").trim().toLowerCase();
  const recoveryCode = body.recovery_code ?? "";
  const newPassword = body.new_password ?? "";

  const pwError = passwordError(newPassword, loginId);
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
      if (err instanceof HttpError) return json({ error: err.code }, err.status);
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
