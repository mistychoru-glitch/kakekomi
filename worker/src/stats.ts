// 利用数の記録（日別の件数だけ）。会話の内容や、利用者を特定できる情報は記録しない。
// 記録に失敗しても、相談そのものを止めない。

export type StatMetric =
  | "consultations" // 新しい相談の開始（最初の1通）
  | "messages" // 相談の送信（AIが返信した回数）
  | "summaries" // 相談内容の保存（要約の作成）
  | "registrations" // 新規登録
  | "crisis" // 危険信号を検知して、固定の案内を返した回数
  | "blocked" // 攻撃の言い回しを検知して、固定の返信で断った回数
  | "reply_filtered" // AIの返信から、未確認の電話番号・リンクを取り除いた回数
  | "leak_blocked"; // システムプロンプトの漏れを検知して、返信を差し替えた回数

// 日付は日本時間で区切る（UTC+9）。
export function jstDay(now = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordStat(
  db: D1Database,
  metric: StatMetric,
  now = Date.now()
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO daily_stats (day, metric, count) VALUES (?1, ?2, 1)
         ON CONFLICT(day, metric) DO UPDATE SET count = count + 1`
      )
      .bind(jstDay(now), metric)
      .run();
  } catch (e) {
    console.warn("failed to record stat", metric, e);
  }
}
