// AIに送る前に、個人情報に見える部分を、自動で伏せる（サーバー側の worker/src/mask.ts と同じ規則）。
// 画面に表示する自分の文章は、そのまま。AIに送る文だけを伏せる。通信はしない。

(function (root) {
  const MASK_LABELS = {
    email: "メールアドレス",
    birthday: "生年月日",
    card: "カード番号",
    mynumber: "12桁の番号",
    phone: "電話番号",
    postal: "郵便番号",
    account: "口座番号",
    address: "番地",
  };

  const SEP = "[-‐‑–−ー\\s]";

  const RULES = [
    { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { kind: "birthday", re: /(?:昭和|平成)\d{1,2}年\d{1,2}月\d{1,2}日|(?:19\d{2}|200\d)年\d{1,2}月\d{1,2}日/g },
    { kind: "card", re: /(?<!\d)(?:\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{3,4}|\d{13,19})(?!\d)/g },
    { kind: "mynumber", re: new RegExp(`(?<!\\d)\\d{4}${SEP}\\d{4}${SEP}\\d{4}(?!\\d)|(?<!\\d)\\d{12}(?!\\d)`, "g") },
    {
      kind: "phone",
      re: new RegExp(
        `(?<!\\d)(?:\\+81${SEP}?|0)\\d{1,4}${SEP}\\d{1,4}${SEP}\\d{3,4}(?!\\d)|(?<!\\d)0[789]0\\d{8}(?!\\d)|(?<!\\d)0\\d{9}(?!\\d)`,
        "g"
      ),
    },
    { kind: "postal", re: /〒\s?\d{3}-?\d{4}(?!\d)|(?<!\d)\d{3}-\d{4}(?![\d-])/g },
    {
      kind: "account",
      re: /(口座(?:番号)?|普通|当座)(\s*[:：は]?\s*)(\d{6,8})(?!\d)/g,
      replace: (_m, head, gap) => `${head}${gap}`,
    },
    { kind: "address", re: /\d+丁目(?:\d+番)?(?:\d+号?)?|\d+番地(?:\d+号?)?|(?<![\d-])\d{1,3}-\d{1,3}-\d{1,3}(?![\d-])/g },
  ];

  function digitsOnly(s) {
    return s.replace(/\D/g, "");
  }

  // 伏せ字に番号をつける（〔電話番号1〕〔電話番号2〕…）。同じ値には、同じ番号。
  // 番号と元の値の対応は、この端末の中だけに持つ（AIにもサーバーにも渡さない）。
  function newRegistry() {
    return { counters: {}, byValue: {}, map: {} };
  }

  function tokenFor(registry, kind, original) {
    const key = `${kind}:${original}`;
    if (registry.byValue[key]) return registry.byValue[key];
    registry.counters[kind] = (registry.counters[kind] || 0) + 1;
    const token = `〔${MASK_LABELS[kind]}${registry.counters[kind]}〕`;
    registry.byValue[key] = token;
    registry.map[token] = original;
    return token;
  }

  // keepDigits: 伏せない電話番号（確認済みの窓口の番号など）。数字だけの文字列の Set
  // registry を渡すと、番号つきの伏せ字になる（要約などで、あとで元に戻せる）
  function maskPersonalInfo(input, keepDigits, registry) {
    const keep = keepDigits || new Set();
    let text = String(input).normalize("NFKC");
    const found = {};
    for (const rule of RULES) {
      text = text.replace(rule.re, (...args) => {
        const m = args[0];
        if (rule.kind === "phone" && keep.has(digitsOnly(m))) return m;
        found[rule.kind] = (found[rule.kind] || 0) + 1;
        const original = rule.kind === "account" ? args[3] : m;
        const label = registry ? tokenFor(registry, rule.kind, original) : `〔${MASK_LABELS[rule.kind]}〕`;
        if (rule.replace) {
          const groups = args.slice(1, -2);
          return `${rule.replace(m, ...groups)}${label}`;
        }
        return label;
      });
    }
    return { text, found };
  }

  // 会話全体を、同じ番号の付け方で伏せる（相談者の発言だけ。AIの発言は、そのまま）。
  // 戻り値の map は、伏せ字→元の値（この端末の中だけで使う）
  function maskConversation(turns, keepDigits) {
    const registry = newRegistry();
    const out = turns.map((t) =>
      t.role === "user" ? { ...t, content: maskPersonalInfo(t.content, keepDigits, registry).text } : t
    );
    return { turns: out, map: registry.map };
  }

  // 伏せ字を、元の値に戻す。対応のない伏せ字は、そのまま残す
  function restoreTokens(text, map) {
    let out = String(text);
    for (const token of Object.keys(map || {}).sort((a, b) => b.length - a.length)) {
      out = out.split(token).join(map[token]);
    }
    return out;
  }

  // 「電話番号1件・メールアドレス1件」のような表示
  function describeFound(found) {
    return Object.entries(found)
      .map(([k, n]) => `${MASK_LABELS[k] || k}${n}件`)
      .join("・");
  }

  const api = { maskPersonalInfo, maskConversation, restoreTokens, describeFound, MASK_LABELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KakekomiMask = api;
})(typeof window !== "undefined" ? window : globalThis);
