// 回数制限（IP単位・アカウント単位・全体の1日あたり）。D1に保存する。
// 目的は、APIの乱用でAnthropicの料金が膨らむのを防ぐこと（厳密な会計ではない）。
//
// - KVではなくD1にしている理由: KVの無料枠は書き込み1日1,000回までで、リクエストごとに
//   書き込む用途には足りない。D1は無料枠でも書き込み1日10万回あり、1文で原子的に数えられる。
// - MACアドレスはインターネット越しには見えない（家庭内LANの外に出る時点で消える）ので、
//   端末の識別には使えない。開発者自身を制限から除外したい場合は DEV_BYPASS_KEY を使う。
// - 窓は「最初のアクセスから windowSeconds 秒」。窓を過ぎた行は次のアクセスで数え直す。

import { timingSafeEqualStrings } from "./auth.ts";

export interface RateLimitEnv {
  DB: D1Database;
  DEV_BYPASS_KEY?: string;
}

const DEV_BYPASS_HEADER = "x-kakekomi-dev-key";
const FOREVER_SECONDS = 60 * 60 * 24 * 365 * 100;

export function isDevBypass(env: RateLimitEnv, req: Request): boolean {
  const key = env.DEV_BYPASS_KEY;
  if (!key) return false;
  return timingSafeEqualStrings(req.headers.get(DEV_BYPASS_HEADER) ?? "", key);
}

/**
 * IPv6は1人が /64（約1,800京個）のアドレスを自由に使えるため、アドレス単位で数えると
 * 回数制限を簡単に回避される。IPv6は前半64ビット（/64）にそろえて数える。
 */
export function normalizeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  // IPv4射影アドレス（::ffff:1.2.3.4）は末尾のIPv4で数える
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);

  const hasGap = ip.includes("::");
  const [head, tail = ""] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = hasGap && tail ? tail.split(":") : [];
  const fill = hasGap ? Math.max(8 - headGroups.length - tailGroups.length, 0) : 0;
  const groups = [...headGroups, ...Array(fill).fill("0"), ...tailGroups];
  const prefix = groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":");
  return `${prefix}::/64`;
}

function clientKey(req: Request): string {
  return normalizeIp(req.headers.get("cf-connecting-ip") ?? "unknown");
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** キーを1回数えて、窓の中での現在の回数を返す（1文で原子的に更新）。 */
async function bump(db: D1Database, key: string, windowSeconds: number): Promise<number> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN expires_at <= ?3 THEN 1 ELSE count + 1 END,
         expires_at = CASE WHEN expires_at <= ?3 THEN ?2 ELSE expires_at END
       RETURNING count`
    )
    .bind(key, now + windowSeconds, now)
    .first<{ count: number }>();

  // 期限切れの行が溜まらないよう、ときどき掃除する
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(now).run();
  }
  return row?.count ?? 1;
}

/** 同じIPからの回数制限。上限以内なら true。 */
export async function checkRateLimit(
  env: RateLimitEnv,
  req: Request,
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  if (isDevBypass(env, req)) return true;
  const count = await bump(env.DB, `${bucket}:${clientKey(req)}`, windowSeconds);
  return count <= limit;
}

/** 時間枠のない恒久的な上限（例: 同一ネットワークからの累計アカウント登録数）。 */
export async function checkLifetimeCap(
  env: RateLimitEnv,
  req: Request,
  bucket: string,
  limit: number
): Promise<boolean> {
  if (isDevBypass(env, req)) return true;
  const count = await bump(env.DB, `lifetime:${bucket}:${clientKey(req)}`, FOREVER_SECONDS);
  return count <= limit;
}

/**
 * 全ユーザー合計の1日あたりのAI利用回数の上限（料金の最終的な歯止め）。
 * 1人1人が個別の上限を守っていても、人数が増えれば料金は膨らむため。
 */
export async function checkDailyBudget(
  env: RateLimitEnv,
  req: Request,
  limit: number
): Promise<boolean> {
  if (isDevBypass(env, req)) return true;
  const count = await bump(env.DB, "global:ai-daily", 24 * 60 * 60);
  return count <= limit;
}

/**
 * アカウント単位の失敗回数ロック（IPを変えて試す総当たりを防ぐ）。
 * 失敗した分だけ recordFailure で数え、isLocked が true の間は照合自体をしない。
 */
export async function isLocked(env: RateLimitEnv, key: string, limit: number): Promise<boolean> {
  const row = await env.DB
    .prepare("SELECT count FROM rate_limits WHERE key = ? AND expires_at > ?")
    .bind(key, nowSeconds())
    .first<{ count: number }>();
  return (row?.count ?? 0) >= limit;
}

export async function recordFailure(
  env: RateLimitEnv,
  key: string,
  windowSeconds: number
): Promise<void> {
  await bump(env.DB, key, windowSeconds);
  // 期限が1日以上前に切れた行を、ときどき消す。IDを変えながらの大量の試行で、表が膨らみ続けないように
  // （恒久の上限の行は、期限がずっと先なので消えない）
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(nowSeconds() - 86400).run();
  }
}
