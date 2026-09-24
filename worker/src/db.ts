import { generateId, generateToken, hashPassword, verifyPassword } from "./auth";

export interface UserRow {
  id: string;
  login_id: string;
  display_name: string;
  password_hash: string;
  plan_status: string; // guest(無料登録) / retain / active（将来のトークン数ベースの課金プラン）
  created_at: string;
}

export interface AuthedUser {
  id: string;
  loginId: string;
  displayName: string;
  planStatus: string;
}

export async function createUser(
  db: D1Database,
  loginId: string,
  displayName: string,
  password: string
): Promise<AuthedUser> {
  const existing = await db
    .prepare("SELECT id FROM users WHERE login_id = ?")
    .bind(loginId)
    .first<{ id: string }>();
  if (existing) {
    throw new Error("login_id_taken");
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      "INSERT INTO users (id, login_id, display_name, password_hash, plan_status, created_at) VALUES (?, ?, ?, ?, 'guest', ?)"
    )
    .bind(id, loginId, displayName, passwordHash, createdAt)
    .run();

  return { id, loginId, displayName, planStatus: "guest" };
}

export async function verifyLogin(
  db: D1Database,
  loginId: string,
  password: string
): Promise<AuthedUser | null> {
  const row = await db
    .prepare(
      "SELECT id, login_id, display_name, password_hash, plan_status FROM users WHERE login_id = ?"
    )
    .bind(loginId)
    .first<Pick<UserRow, "id" | "login_id" | "display_name" | "password_hash" | "plan_status">>();
  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  return { id: row.id, loginId: row.login_id, displayName: row.display_name, planStatus: row.plan_status };
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = generateToken();
  await db
    .prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)")
    .bind(token, userId, new Date().toISOString())
    .run();
  return token;
}

const SESSION_TTL_DAYS = 30;

export async function getUserByToken(db: D1Database, token: string): Promise<AuthedUser | null> {
  const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT users.id as id, users.login_id as login_id, users.display_name as display_name, users.plan_status as plan_status
       FROM sessions JOIN users ON sessions.user_id = users.id
       WHERE sessions.token = ? AND sessions.created_at > ?`
    )
    .bind(token, cutoff)
    .first<{ id: string; login_id: string; display_name: string; plan_status: string }>();
  if (!row) return null;
  return { id: row.id, loginId: row.login_id, displayName: row.display_name, planStatus: row.plan_status };
}

// 注意: 学校の卒業制作レギュレーション上、会話内容そのものをサーバー側（D1）に
// 保存することはしない方針とした（メンターとの壁打ちを踏まえた決定）。
// ID/パスワードなど断片的なアカウント情報の保管のみ行う。
// プラン変更は将来のトークン数ベースの課金の土台として残す（決済処理は未実装）。
export async function upgradePlan(db: D1Database, userId: string, plan: string): Promise<void> {
  await db.prepare("UPDATE users SET plan_status = ? WHERE id = ?").bind(plan, userId).run();
}
