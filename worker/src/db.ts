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

// 開発者アカウント用。パスワードの照合はシークレットで行うため、DBにはログインに使えない
// ダミーのハッシュを持つ行だけを作る（行があれば、セッションの紐付け先として使う）。
export async function ensureAdminUser(db: D1Database, loginId: string): Promise<AuthedUser> {
  const row = await db
    .prepare("SELECT id, display_name, plan_status FROM users WHERE login_id = ?")
    .bind(loginId)
    .first<{ id: string; display_name: string; plan_status: string }>();
  if (row) {
    return { id: row.id, loginId, displayName: row.display_name, planStatus: row.plan_status };
  }

  const id = generateId();
  const unusableHash = await hashPassword(generateToken());
  await db
    .prepare(
      "INSERT INTO users (id, login_id, display_name, password_hash, plan_status, created_at) VALUES (?, ?, ?, ?, 'admin', ?)"
    )
    .bind(id, loginId, "管理者", unusableHash, new Date().toISOString())
    .run();
  return { id, loginId, displayName: "管理者", planStatus: "admin" };
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

const SESSION_TTL_DAYS = 30;

function sessionCutoff(): string {
  return new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  // 期限切れセッションが溜まり続けないよう、新規作成のついでに掃除する
  await db.prepare("DELETE FROM sessions WHERE created_at <= ?").bind(sessionCutoff()).run();

  const token = generateToken();
  await db
    .prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)")
    .bind(token, userId, new Date().toISOString())
    .run();
  return token;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export async function getUserByToken(db: D1Database, token: string): Promise<AuthedUser | null> {
  const cutoff = sessionCutoff();
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
