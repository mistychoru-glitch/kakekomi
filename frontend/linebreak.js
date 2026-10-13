// 日本語の改行を、単語の途中で切れにくくする。
// ブラウザの自動の文節分け（word-break: auto-phrase）は、「立て/替えて」「より/そい」のように、
// 単語の途中で切ることがある。そこで、途中で切りたくない言葉を、折り返さない範囲（.lb）で包む。
// 画面に出た文字（会話・まとめノート・窓口の一覧・説明の画面）に、あとから適用する。
(function () {
  const KANJI = "\\u4E00-\\u9FFF\\u3005";
  const HIRA = "\\u3040-\\u309F";
  const KATA = "\\u30A0-\\u30FF";

  // 途中で切りたくない、よく出る言葉（長い順に並べる）
  const TERMS = [
    "労働条件相談ほっとライン", "よりそいホットライン", "未払賃金立替払制度", "総合労働相談コーナー",
    "住居確保給付金", "自立相談支援機関", "未払賃金立替払", "労働基準監督署", "登記事項証明書", "国民健康保険",
    "民事法律扶助", "事実上の倒産", "立替払制度", "生活困窮者", "住宅金融支援機構", "日本年金機構", "労働者健康安全機構",
    "市区町村", "債務承認書", "年金事務所", "消費者金融", "期限の利益", "源泉徴収", "確定申告", "未払賃金",
    "定期賃金", "退職手当", "国民年金", "生活保護", "自己破産", "個人再生", "任意整理", "住宅ローン",
    "督促状", "差押え", "立替払", "法テラス", "大丈夫", "お住まい", "お金", "方法", "確認", "相談", "状況",
    "手をつけ", "により", "によって", "について", "において", "として", "ために", "ように", "ような", "といった", "という",
    "立て替え", "立替え", "受け取", "引き継", "差し押さえ", "取り立て", "申し込み", "振り込み", "見込み", "持ち出", "払い込み",
  ].sort((a, b) => b.length - a.length);

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const RULES = [
    new RegExp("(?:" + TERMS.map(esc).join("|") + ")", "y"),
    // 数字＋単位（6か月、176万円、30歳 など）
    /[0-9０-９][0-9０-９,，.．]*(?:か月|ヶ月|ケ月|カ月|万円|億円|千円|円|％|%|歳|日|月|年|時|分|件|人|割|社|回|週間|か所|か国)/y,
    // 「…」と（…）の短いまとまり
    /「[^「」\n]{1,14}」/y,
    /（[^（）\n]{1,14}）/y,
    /【[^【】\n]{1,14}】/y,
    // 英字＋漢字（AI事業者 など）
    new RegExp("[A-Za-z][A-Za-z0-9]{0,11}[" + KANJI + "]{1,4}", "y"),
    // カタカナの連続（ホットライン など）
    new RegExp("[" + KATA + "ー]{3,14}", "y"),
  ];
  // 漢字＋送りがな＋漢字＋送りがな（立て替えて、受け取れる、引き継ぐ など）。助詞だけの間は除く。
  // 前が漢字のとき（電話して聞く の「話」など）は、熟語の一部を切り取らないよう、対象にしない。
  const COMPOUND = new RegExp(
    "(?<![" + KANJI + "])[" + KANJI + "]([" + HIRA + "]{1,2})[" + KANJI + "]{1,2}[" + HIRA + "]{0,4}(?![" + HIRA + KANJI + "])",
    "y"
  );
  // 間のひらがなが、これだけのとき（助詞）は、送りがな（立て替え など）ではないので、まとめない
  const PARTICLES = new Set([
    "が", "は", "を", "に", "で", "の", "と", "も", "へ", "や", "か", "ね", "よ", "し", "ば",
    "から", "まで", "より", "など", "だけ", "ので", "には", "では", "への", "との", "でも", "しか", "ほど", "って", "とは", "ては",
  ]);
  const MAX_CHUNK = 14;

  function tryAt(text, i) {
    for (const re of RULES) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length >= 2 && m[0].length <= MAX_CHUNK) return m[0].length;
    }
    COMPOUND.lastIndex = i;
    const c = COMPOUND.exec(text);
    if (c && c[0].length <= MAX_CHUNK && !PARTICLES.has(c[1])) return c[0].length;
    return 0;
  }

  // 文字列を、[ {text, keep} ] に分ける。keep=true は、途中で切らない範囲。
  function split(text) {
    const out = [];
    let plain = "";
    let i = 0;
    while (i < text.length) {
      const len = tryAt(text, i);
      if (len > 0) {
        if (plain) { out.push({ text: plain, keep: false }); plain = ""; }
        out.push({ text: text.slice(i, i + len), keep: true });
        i += len;
      } else {
        plain += text[i];
        i += 1;
      }
    }
    if (plain) out.push({ text: plain, keep: false });
    return out;
  }

  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE"]);
  const JA = /[぀-ヿ一-鿿]/;

  function applyTo(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.closest && root.closest(".lb, [data-no-lb]")) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP.has(p.tagName) || p.closest(".lb, [data-no-lb]")) return NodeFilter.FILTER_REJECT;
        return JA.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      const parts = split(node.nodeValue);
      if (!parts.some((p) => p.keep)) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (p.keep) {
          const s = document.createElement("span");
          s.className = "lb";
          s.textContent = p.text;
          frag.appendChild(s);
        } else {
          frag.appendChild(document.createTextNode(p.text));
        }
      }
      node.parentNode.replaceChild(frag, node);
    }
  }

  let queued = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const roots = Array.from(queued);
    queued = new Set();
    for (const r of roots) applyTo(r);
  }
  function enqueue(el) {
    if (!el || el.nodeType !== 1) return;
    queued.add(el);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  }

  function start() {
    enqueue(document.body);
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        for (const added of r.addedNodes) {
          if (added.nodeType === 1) enqueue(added);
          else if (added.nodeType === 3 && added.parentElement) enqueue(added.parentElement);
        }
        if (r.type === "characterData" && r.target.parentElement) enqueue(r.target.parentElement);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.KakekomiLineBreak = { split, applyTo };
})();
