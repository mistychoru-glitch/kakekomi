// 「次の一歩」まわりの、画面側の部品。
// - 根拠のリンクは、確認済みの公式サイトのものだけを表示する（保存ファイルから読み込んだ値は信用しない）
// - 各一歩の進み具合（まだ／やった／できなかった）を、保存ファイルに持たせ、再開のときに前回の続きとして聞く
// 通信はしない。

(function (root) {
  // 根拠として表示してよいサイト（サーバー側の sources.ts と合わせる）
  const TRUSTED_HOSTS = [
    "houterasu.or.jp",
    "mhlw.go.jp",
    "nta.go.jp",
    "nenkin.go.jp",
    "jhf.go.jp",
    "jfc.go.jp",
    "smrj.go.jp",
    "minna-tunagaru.jp",
  ];

  function isTrustedSourceUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && TRUSTED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
    } catch (e) {
      return false;
    }
  }

  const STATUS_LABELS = { todo: "まだ", done: "やった", blocked: "できなかった" };
  const ID_PATTERN = /^[a-z0-9_]{1,60}$/;

  function cleanSource(src) {
    if (!src || typeof src !== "object") return undefined;
    if (typeof src.url !== "string" || !isTrustedSourceUrl(src.url)) return undefined;
    const label = typeof src.label === "string" ? src.label.slice(0, 80) : "";
    const verifiedAt = typeof src.verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(src.verifiedAt) ? src.verifiedAt : "";
    if (!label) return undefined;
    return { label, url: src.url, verifiedAt };
  }

  // 保存ファイルから読み込んだ「次の一歩」を、表示してよい形にそろえる
  function sanitizeCandidates(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((c) => c && typeof c.id === "string" && ID_PATTERN.test(c.id) && typeof c.action === "string" && typeof c.caveat === "string")
      .slice(0, 20)
      .map((c) => {
        const out = { id: c.id, action: c.action.slice(0, 300), caveat: c.caveat.slice(0, 600) };
        const source = cleanSource(c.source);
        if (source) out.source = source;
        return out;
      });
  }

  // 進み具合は、いまある「次の一歩」の id だけを、決まった値だけ受け入れる
  function sanitizeProgress(progress, candidates) {
    const ids = new Set((candidates || []).map((c) => c.id));
    const out = {};
    if (!progress || typeof progress !== "object") return out;
    for (const [id, status] of Object.entries(progress)) {
      if (ids.has(id) && (status === "done" || status === "blocked")) out[id] = status;
    }
    return out;
  }

  function statusOf(progress, id) {
    const s = progress && progress[id];
    return s === "done" || s === "blocked" ? s : "todo";
  }

  // 例: 「・銀行に相談する：やった」
  function progressLines(candidates, progress) {
    return (candidates || []).map((c) => `・${c.action}：${STATUS_LABELS[statusOf(progress, c.id)]}`);
  }

  // 再開のときの、AIに渡す文と、画面に出す最初の一言（固定の文。AIは使わない）
  function resumeMessages(summary, candidates, progress) {
    const cands = candidates || [];
    const block =
      cands.length > 0 ? `\n\n【前回の次の一歩の進み具合】\n${progressLines(cands, progress).join("\n")}` : "";
    const userText = `【前回の相談の要約】\n${summary}${block}\n\n上の内容は、以前の相談を保存したファイルから読み込んだものです。この続きから相談させてください。`;

    let assistantText;
    const pending = cands.find((c) => statusOf(progress, c.id) !== "done");
    if (cands.length === 0) {
      assistantText =
        "前回の相談内容を読み込みました。ここから続きを一緒に整理していきましょう。\n\nその後、状況に変わったことはありますか？気になっていることがあれば、そのまま書いてください。";
    } else if (!pending) {
      assistantText =
        "前回の相談内容を読み込みました。前回の次の一歩は、すべて済んでいるのですね。\n\nその後、状況に変わったことはありますか？気になっていることがあれば、そのまま書いてください。";
    } else {
      const status = statusOf(progress, pending.id);
      const ask =
        status === "blocked"
          ? `前回の次の一歩「${pending.action}」は、できなかったのですね。何が難しかったか、教えてもらえますか？`
          : `前回の次の一歩「${pending.action}」は、その後どうなりましたか？`;
      assistantText = `前回の相談内容を読み込みました。\n\n${ask}\n\nできたこと、できなかったこと、新しく起きたことを、そのまま書いてください。`;
    }
    return { userText, assistantText };
  }

  const api = { TRUSTED_HOSTS, STATUS_LABELS, isTrustedSourceUrl, sanitizeCandidates, sanitizeProgress, statusOf, progressLines, resumeMessages };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KakekomiSteps = api;
})(typeof window !== "undefined" ? window : globalThis);
