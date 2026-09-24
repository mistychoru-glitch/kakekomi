// IPアドレスごとの簡易レート制限。APIキーの乱用によるコスト暴走を防ぐための
// 最低限のガード（厳密な正確性より、荒らし・スクリプトによる連打を鈍らせる目的）。
//
// 注意: MACアドレスはインターネット越しには絶対に見えない（家庭内LANの外に出る時点で
// 消える情報のため）ので、端末を識別する手段としては使えない。開発者自身を制限から
// 除外したい場合は DEV_BYPASS_KEY（合言葉）方式を使うこと。IPアドレスは動的に変わる
// ことが多いため、恒久的な識別子としては信頼しない。

export interface RateLimitEnv {
  RATE_LIMIT: KVNamespace;
  DEV_BYPASS_KEY?: string;
}

const DEV_BYPASS_HEADER = "x-kakekomi-dev-key";

export function isDevBypass(env: RateLimitEnv, req: Request): boolean {
  const key = env.DEV_BYPASS_KEY;
  if (!key) return false;
  return req.headers.get(DEV_BYPASS_HEADER) === key;
}

export async function checkRateLimit(
  env: RateLimitEnv,
  req: Request,
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  if (isDevBypass(env, req)) return true;

  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${bucket}:${ip}:${windowIndex}`;

  const current = await env.RATE_LIMIT.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return false;
  }

  await env.RATE_LIMIT.put(key, String(count + 1), {
    expirationTtl: windowSeconds * 2,
  });
  return true;
}

/**
 * 時間枠のない恒久的な上限（例: 同一IPからの累計アカウント登録数）。
 * 一度枠を使い切ると、そのIPでは二度と許可されない。
 */
export async function checkLifetimeCap(
  env: RateLimitEnv,
  req: Request,
  bucket: string,
  limit: number
): Promise<boolean> {
  if (isDevBypass(env, req)) return true;

  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `${bucket}:lifetime:${ip}`;

  const current = await env.RATE_LIMIT.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return false;
  }

  await env.RATE_LIMIT.put(key, String(count + 1));
  return true;
}
