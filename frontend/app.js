// 会話履歴・構造化状態は常にブラウザのlocalStorageのみに保持し、サーバー（D1）には
// 一切書き込まない。学校のレギュレーション、および機密情報を保管するリスクを踏まえて、
// 会話内容そのものはサーバーに一切保存しない方針とした（ログイン機能のみ提供）。
// 残しておきたい場合は「相談内容を保存する」でMarkdownファイルとしてダウンロードする。

// 画面とAPIは同じWorkerから配信されるので、通常は同じオリジンの /api を呼ぶ。
// HTMLファイルを直接開いた場合（file://）だけ、ローカルの開発サーバーを指す。
const API_BASE =
  window.KAKEKOMI_API_BASE ?? (location.protocol === "file:" ? "http://127.0.0.1:8787" : "");
const STORAGE_KEY = "kakekomi_guest_session_v1";
const ACCOUNT_KEY = "kakekomi_account_v1";
const DEV_KEY_STORAGE = "kakekomi_dev_key";
const MESSAGE_MAX = 2000;

// 開発者本人の回数制限を外すための合言葉。ブラウザのコンソールで一度だけ
// localStorage.setItem("kakekomi_dev_key", "（サーバー側で設定した合言葉）") を
// 実行しておけば、このMacBookのこのブラウザでは以後ずっと無制限になる。
function devHeaders() {
  try {
    const key = localStorage.getItem(DEV_KEY_STORAGE);
    return key ? { "x-kakekomi-dev-key": key } : {};
  } catch (e) {
    return {};
  }
}

const messagesEl = document.getElementById("messages");
const notesEl = document.getElementById("notes");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const newSessionButton = document.getElementById("new-session");
const exportNoteButton = document.getElementById("export-note");
const accountArea = document.getElementById("account-area");
const notesPanel = document.getElementById("note-panel");
const notesOpenButton = document.getElementById("notes-open");

// スマホでは、まとめノートは「まとめノート」ボタンで開く全画面の表示にしている。
function setNotesOpen(open) {
  notesPanel.classList.toggle("open", open);
  notesOpenButton.setAttribute("aria-expanded", String(open));
  if (open) notesPanel.scrollTop = 0;
}
notesOpenButton.addEventListener("click", () => setNotesOpen(true));
document.getElementById("notes-close").addEventListener("click", () => setNotesOpen(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && notesPanel.classList.contains("open")) setNotesOpen(false);
});

// ---- 会話セッション（chat）の状態 ----

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("failed to load session", e);
  }
  return { history: [], state: null, lastCandidates: [], progress: {} };
}

function saveSession(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("failed to save session", e);
  }
}

let session = loadSession();
if (!session.progress || typeof session.progress !== "object") session.progress = {};

// ---- アカウント状態 ----

function loadAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("failed to load account", e);
  }
  return null;
}

function saveAccount(acc) {
  account = acc;
  try {
    if (acc) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch (e) {
    console.warn("failed to save account", e);
  }
  renderAccountUI();
}

let account = loadAccount();

async function authedFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), ...devHeaders() };
  if (account) headers["authorization"] = `Bearer ${account.token}`;
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// ---- 画面描画 ----

// "/" は、狭い画面での改行の位置（2行の長さをそろえる）。"|" は、言葉のまとまりの区切り（途中で切らない）。
// 入力欄に入れるときは、どちらも取り除く。
const EXAMPLE_PROMPTS = [
  "お金のことで|悩んでいるけれど、/誰にも|言えずにいます",
  "家賃を滞納してしまい、/大家さんから|督促状が届きました",
  "借金の返済が苦しくて、/毎月の支払いに|追われています",
  "収入が減って、|今の家賃を/払い続けられるか|不安です",
  "事業の資金繰りが厳しく、/来月の支払いが|心配です",
];

// 日本語は、画面が狭いと単語の途中で折り返されるので、言葉のまとまりごとに折り返す。
// "|" で区切った部分は、途中で切れない。
function phrases(text) {
  const wrapPhrases = (line) =>
    line
      .split("|")
      .map((p) => `<span class="nb">${p}</span>`)
      .join("");
  // "/" の位置では、狭い画面でだけ改行する（広い画面では1行のまま）
  return text.split("/").map(wrapPhrases).join('<br class="soft-br">');
}

function renderWelcome() {
  const wrap = document.createElement("div");
  wrap.className = "welcome";
  wrap.innerHTML = `
    <p class="welcome-lead">${phrases("誰にも言えない|お金の悩みが|できてしまった人へ。")}</p>
    <p class="welcome-sub">${phrases("匿名・登録なしで、|状況を整理して、|今日の一歩と|電話の台本まで|一緒に作ります。")}<br>${phrases("うまく書けなくても大丈夫です。|思いつくままに書いてください。|下の例を選んで、|書き換えて送ることもできます。")}</p>
  `;
  const list = document.createElement("div");
  list.className = "welcome-examples";
  for (const text of EXAMPLE_PROMPTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "example-chip";
    const plain = text.replace(/[|/]/g, "");
    btn.innerHTML = phrases(text);
    btn.addEventListener("click", () => {
      input.value = plain;
      autoGrow();
      input.focus();
    });
    list.appendChild(btn);
  }
  wrap.appendChild(list);

  const privacy = document.createElement("p");
  privacy.className = "welcome-privacy";
  privacy.innerHTML = phrases("電話番号・メール・口座番号などは、|書いても、|AIには自動で伏せて送ります。");
  wrap.appendChild(privacy);

  const resume = document.createElement("p");
  resume.className = "welcome-resume";
  resume.innerHTML =
    '前に保存したファイルがある方は、<button type="button" class="link-btn" id="import-open">前回の相談の続きから始める</button><br>経営者の方は、<button type="button" class="link-btn" id="cashflow-open">資金繰りチェック</button>もできます';
  wrap.appendChild(resume);
  messagesEl.appendChild(wrap);
}

function renderMessages() {
  messagesEl.innerHTML = "";
  // スマホでは、会話が始まったら説明バナーを隠して、会話の場所を広げる（CSS側で判定）
  document.body.classList.toggle("has-history", session.history.length > 0);
  if (session.history.length === 0) {
    renderWelcome();
    return;
  }
  const tokenMap = maskedConversation(session.history).map;
  for (const turn of session.history) {
    const div = document.createElement("div");
    div.className = `msg ${turn.role}`;
    div.textContent = turn.role === "assistant" ? restoreFromMap(turn.content, tokenMap) : turn.content;
    messagesEl.appendChild(div);
    if (turn.role === "user" && turn.masked && Object.keys(turn.masked).length > 0) {
      const note = document.createElement("div");
      note.className = "mask-note";
      note.textContent = `AIには、${KakekomiMask.describeFound(turn.masked)}を伏せて送りました`;
      messagesEl.appendChild(note);
    }
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- 「いまの状況」カード（会話から読み取れた内容を、サーバーに送った状態から表示する） ----

const THEME_LABELS = {
  housing: "住まい・家賃",
  mortgage: "住宅ローン",
  debt: "借金・返済",
  income_loss: "収入の減少",
  tax_or_insurance_arrears: "税・保険料の滞納",
  other: "その他",
};
const URGENCY_LABELS = { crisis: "とても急ぎ", urgent: "急ぎ", steady: "落ち着いて対応できる" };
const FLAG_LABELS = {
  legal_proceeding_confirmed: "裁判・強制執行の段階に入っている",
  notice_type_unknown: "届いた書面の種類が未確認",
  collection_fear_strong: "取り立てへの不安が強い",
  has_children: "お子さんがいる",
  cannot_afford_moving_cost: "転居費用が用意できない",
  already_consulted_no_resolution: "相談したが解決しなかった",
  payroll_urgency: "給与の支払いが迫っている",
  mortgage_acceleration_notified: "一括返済を求める通知（期限の利益の喪失）が届いている",
  mortgage_auction_started: "競売の手続きが始まっている",
  tax_seizure_notice: "差押えの予告・差押えが来ている",
};

function situationRows(state) {
  if (!state) return { rows: [], flags: [] };
  const p = state.personal || {};
  const b = state.business || {};
  const rows = [];
  const add = (label, value) => {
    if (value !== null && value !== undefined && value !== "") rows.push([label, String(value)]);
  };

  const themes = (p.sub_category || []).map((s) => THEME_LABELS[s]).filter(Boolean);
  if (state.category === "business") add("相談の種類", "事業の資金繰り");
  else if (state.category === "personal") add("相談の種類", themes.length ? themes.join("・") : "個人の暮らし");
  add("緊急度", URGENCY_LABELS[state.urgency_level]);
  add("家賃", p.rent_amount);
  add("エリア", p.area);
  add("収入", [p.monthly_income_estimate, p.income_type].filter(Boolean).join("（") + (p.monthly_income_estimate && p.income_type ? "）" : ""));
  add("家族", p.family_composition);
  add("借入", p.debt_count ? `${p.debt_count}件` : null);
  add("住宅ローンの滞納", p.mortgage_months_behind ? `${p.mortgage_months_behind}か月分` : null);
  const arrears = [
    p.arrears_national_tax && "国税（所得税・消費税など）",
    p.arrears_local_tax && "住民税などの地方税",
    p.arrears_health_insurance && "国民健康保険料",
    p.arrears_pension && "国民年金保険料",
  ].filter(Boolean);
  add("滞納している税・保険料", arrears.length ? arrears.join("、") : null);
  add("月の返済額", p.monthly_repayment_total);
  add("届いた通知・期限", p.notice_received);
  add("資金の見通し", b.cash_runway);
  add("差し迫った期限", b.critical_deadline);
  add("売上の傾向", b.revenue_trend);
  add("従業員", b.employee_count ? `${b.employee_count}人` : null);

  const flags = [];
  for (const [key, label] of Object.entries(FLAG_LABELS)) {
    if (p[key] === true || b[key] === true) flags.push(label);
  }
  return { rows, flags };
}

function renderSituation() {
  const { rows, flags } = situationRows(session.state);
  const section = document.getElementById("situation");
  section.hidden = rows.length === 0 && flags.length === 0;
  document.getElementById("situation-list").innerHTML = rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
  document.getElementById("situation-flags").innerHTML = flags
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join("");
}

// ---- 相談窓口の一覧（サーバーの一覧をそのまま表示。AIが案内する番号と同じもの） ----

let resourcesCache = [];

async function loadResources() {
  const listEl = document.getElementById("resources-list");
  try {
    const res = await fetch(`${API_BASE}/api/resources`, { headers: devHeaders() });
    if (!res.ok) throw new Error("failed");
    const { resources } = await res.json();
    resourcesCache = resources;
    renderNotes();
    listEl.innerHTML = resources
      .map((r) => {
        const phone = r.phone
          ? `<p class="resource-phone"><a href="tel:${escapeHtml(r.phone.replace(/[^0-9]/g, ""))}">${escapeHtml(r.phone)}</a>${r.hours ? `<span>${escapeHtml(r.hours)}</span>` : ""}</p>`
          : "";
        const how = r.howToFind ? `<p class="resource-how">${escapeHtml(r.howToFind)}</p>` : "";
        // 公式の探し方ページ。https のリンクだけを表示する
        const link =
          r.link && /^https:\/\//.test(r.link.url)
            ? `<p class="resource-link"><a href="${escapeHtml(r.link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.link.label)}</a></p>`
            : "";
        return `<div class="resource"><p class="resource-name">${escapeHtml(r.name)}</p>${phone}<p class="resource-does">${escapeHtml(r.whatTheyDo)}</p>${how}${link}</div>`;
      })
      .join("");
  } catch (e) {
    console.warn("failed to load resources", e);
    listEl.innerHTML = '<p class="notes-empty">相談窓口の一覧を読み込めませんでした。</p>';
  }
}

const callScriptOpenButton = document.getElementById("call-script-open");

function currentCallScript() {
  return window.KakekomiCallScript
    ? window.KakekomiCallScript.buildCallScript(session.state, resourcesCache)
    : null;
}

callScriptOpenButton.addEventListener("click", () => {
  const script = currentCallScript();
  if (!script) return;
  document.getElementById("call-script-title").textContent = script.title;
  document.getElementById("call-script-text").textContent = script.text;
  openModal("call-script-modal");
});

document.getElementById("call-script-copy").addEventListener("click", async (e) => {
  const text = document.getElementById("call-script-text").textContent;
  const button = e.currentTarget;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "コピーしました";
  } catch (err) {
    // クリップボードが使えないときは、文面を選択状態にして、手でコピーしてもらう
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("call-script-text"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    button.textContent = "選択しました（コピーしてください）";
  }
  setTimeout(() => (button.textContent = "コピー"), 2500);
});

// 「いまここ」の段階図（状況から、決まったルールで作る。AIは使わない）
function renderStageMap() {
  const el = document.getElementById("stage-map");
  const map = window.KakekomiStageMap ? window.KakekomiStageMap.buildStageMap(session.state) : null;
  el.hidden = !map;
  el.innerHTML = "";
  if (!map) return;
  const node = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  el.appendChild(node("h3", "", "いまの位置（目安）"));
  el.appendChild(node("p", "stage-title", map.title));
  const ol = node("ol", "stage-list");
  map.stages.forEach((s) => {
    const li = node("li", `stage stage-${s.status}`);
    const head = node("div", "stage-head");
    head.appendChild(node("span", "stage-dot"));
    head.appendChild(node("span", "stage-label", s.label));
    if (s.status === "here") head.appendChild(node("span", "stage-badge", map.hereLabel));
    li.appendChild(head);
    if (s.status === "here") {
      li.appendChild(node("p", "stage-note", s.note));
      const opts = node("ul", "stage-options");
      map.options.forEach((t) => opts.appendChild(node("li", "", t)));
      li.appendChild(opts);
    }
    ol.appendChild(li);
  });
  el.appendChild(ol);
  el.appendChild(node("p", "stage-foot", map.foot));
}

function renderNotes() {
  renderSituation();
  renderStageMap();
  const candidates = session.lastCandidates || [];
  // スマホの「まとめノート」ボタンに、中身があることを示す印を付ける
  const hasSituation = !document.getElementById("situation").hidden;
  notesOpenButton.classList.toggle("has-notes", hasSituation || candidates.length > 0);
  callScriptOpenButton.hidden = !currentCallScript();
  cashflowNoteButton.hidden = !(session.state && session.state.category === "business");
  document.getElementById("notes-heading").hidden = candidates.length === 0;
  if (candidates.length === 0) {
    notesEl.innerHTML =
      '<p class="notes-empty">会話が進むと、ここに整理された内容が付箋のように表示されます。</p>';
    return;
  }
  notesEl.innerHTML = "";
  for (const c of candidates) {
    const status = KakekomiSteps.statusOf(session.progress, c.id);
    const div = document.createElement("div");
    div.className = `sticky${status === "done" ? " is-done" : ""}`;
    const action = document.createElement("p");
    action.className = "action";
    action.textContent = c.action;
    const caveat = document.createElement("p");
    caveat.className = "caveat";
    caveat.textContent = c.caveat;
    div.append(action, caveat);

    // 根拠: 確認済みの公式サイトのリンクと、確認日（確かめられていない一歩には出さない）
    if (c.source && KakekomiSteps.isTrustedSourceUrl(c.source.url)) {
      const p = document.createElement("p");
      p.className = "source";
      p.append(document.createTextNode("根拠: "));
      const a = document.createElement("a");
      a.href = c.source.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = c.source.label;
      p.appendChild(a);
      if (c.source.verifiedAt) p.append(document.createTextNode(`（確認日 ${c.source.verifiedAt}）`));
      div.appendChild(p);
    }

    // 進み具合: まだ／やった／できなかった（保存ファイルに持ち越して、再開のときに聞く）
    const group = document.createElement("div");
    group.className = "progress";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "この一歩の進み具合");
    for (const key of ["todo", "done", "blocked"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `progress-btn progress-${key}`;
      b.textContent = KakekomiSteps.STATUS_LABELS[key];
      b.setAttribute("aria-pressed", String(status === key));
      b.addEventListener("click", () => {
        if (key === "todo") delete session.progress[c.id];
        else session.progress[c.id] = key;
        saveSession(session);
        renderNotes();
      });
      group.appendChild(b);
    }
    div.appendChild(group);
    notesEl.appendChild(div);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAccountUI() {
  if (!account) {
    accountArea.innerHTML = `<button type="button" id="login-open" class="link-btn">ログイン / 登録</button>`;
    return;
  }
  accountArea.innerHTML = `
    <span>${escapeHtml(account.displayName)}さん</span>
    <button type="button" id="logout-btn" class="link-btn">ログアウト</button>
  `;
}

// ---- モーダル共通 ----

function openModal(id) {
  document.getElementById(id).hidden = false;
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
}

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (overlay.hasAttribute("data-static")) return;
    if (e.target === overlay || e.target.hasAttribute("data-close")) {
      overlay.hidden = true;
    }
  });
});

// ---- ご利用にあたって（初回のみ表示。「理解して始める」を押すまで閉じられない） ----

const TERMS_KEY = "kakekomi_terms_accepted_v1";

function termsAccepted() {
  try {
    return localStorage.getItem(TERMS_KEY) === "1";
  } catch (e) {
    return false;
  }
}

document.getElementById("terms-accept").addEventListener("click", () => {
  try {
    localStorage.setItem(TERMS_KEY, "1");
  } catch (e) {
    console.warn("failed to save terms acceptance", e);
  }
  closeModal("terms-modal");
  input.focus();
});

document.getElementById("open-terms").addEventListener("click", () => openModal("terms-modal"));

if (!termsAccepted()) openModal("terms-modal");

// ---- チャット送信 ----

function autoGrow() {
  input.style.height = "auto";
  const max = window.innerHeight * 0.4;
  input.style.height = Math.min(input.scrollHeight, max) + "px";
  updateCharCount();
}

const charCountEl = document.getElementById("char-count");

function updateCharCount() {
  const len = input.value.length;
  charCountEl.hidden = len < MESSAGE_MAX * 0.8;
  charCountEl.textContent = `${len} / ${MESSAGE_MAX}`;
}

const maskHint = document.getElementById("mask-hint");

function updateMaskHint() {
  const { found } = KakekomiMask.maskPersonalInfo(input.value, maskKeepDigits());
  const desc = KakekomiMask.describeFound(found);
  maskHint.hidden = !desc;
  if (desc) maskHint.textContent = `${desc}は、AIには伏せて送ります（この画面には、そのまま残ります）`;
}

input.addEventListener("input", () => {
  autoGrow();
  updateMaskHint();
});

// スマホ・タブレット（指で操作する端末）では、Enterは改行にして、送信は「送る」ボタンだけにする。
const touchOnly = window.matchMedia("(hover: none) and (pointer: coarse)");

const PLACEHOLDER_DESKTOP = "今の状況を、思うままに書いてください\n（Enterで送信、Shift+Enterで改行）";
const PLACEHOLDER_TOUCH = "思うままに、書いてください";

function updatePlaceholder() {
  input.placeholder = touchOnly.matches ? PLACEHOLDER_TOUCH : PLACEHOLDER_DESKTOP;
}
updatePlaceholder();
touchOnly.addEventListener("change", updatePlaceholder);

// スマホでキーボードが出ても、入力欄が画面の下に見えたままになるよう、
// 見えている領域（キーボードを除いた高さ）にアプリの高さを合わせる。
if (window.visualViewport) {
  const syncViewportHeight = () => {
    if (!touchOnly.matches) {
      document.documentElement.style.removeProperty("--app-h");
      return;
    }
    document.documentElement.style.setProperty("--app-h", `${window.visualViewport.height}px`);
    window.scrollTo(0, 0);
  };
  window.visualViewport.addEventListener("resize", syncViewportHeight);
  window.visualViewport.addEventListener("scroll", syncViewportHeight);
  syncViewportHeight();
}

input.addEventListener("keydown", (e) => {
  // PC: Enterで送信、Shift+Enterで改行（Mac/Windows共通の一般的なチャットUIの挙動）。
  // 日本語入力の変換確定Enter（isComposing / keyCode 229）は送信扱いにしない。
  if (touchOnly.matches) return;
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    form.requestSubmit();
  }
});

function mergeCandidates(existing, incoming) {
  const merged = [...(existing || [])];
  for (const c of incoming || []) {
    if (!merged.some((m) => m.id === c.id)) merged.push(c);
  }
  return merged;
}

function chatErrorMessage(res, data) {
  if (data && data.error === "daily_limit") {
    return "本日のAI利用が上限に達しました。明日またお試しください。お急ぎの場合は、画面右の「相談窓口の一覧」からお近くの窓口にご相談ください。";
  }
  if (res.status === 429) {
    return "短い時間にたくさん送信されたため、少し時間をおいてからもう一度お試しください。";
  }
  if (data && data.error === "message_too_long") {
    return `メッセージが長すぎます。${MESSAGE_MAX}文字以内に分けて送ってください。`;
  }
  return "通信エラーが発生しました。少し時間をおいて、もう一度試してください。";
}

function showTypingIndicator() {
  const div = document.createElement("div");
  div.id = "typing-indicator";
  div.className = "msg assistant typing";
  div.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 伏せない電話番号（確認済みの窓口と、危険信号のときの窓口）
function maskKeepDigits() {
  const keep = new Set(["0120279338", "0120061338", "0570783556"]);
  for (const r of resourcesCache) if (r.phone) keep.add(r.phone.replace(/\D/g, ""));
  return keep;
}

// AIに送る会話: 相談者の発言は、個人情報に見える部分を、番号つきの伏せ字（〔電話番号1〕など）にする。
// AIの発言は、署名つきのまま。伏せ字→元の値の対応(map)は、この端末の中だけに持つ。
function maskedConversation(turns) {
  const conv = KakekomiMask.maskConversation(turns, maskKeepDigits());
  const out = conv.turns.map((t) =>
    t.role === "user" ? { role: "user", content: t.content } : { role: "assistant", content: t.content, sig: t.sig }
  );
  return { turns: out, map: conv.map };
}

// 伏せ字を、この端末の中で、元の値に戻す（AIの返信や、要約に伏せ字が出てきたときのため）
function restoreFromMap(text, map) {
  return KakekomiMask.restoreTokens(text, map);
}

async function sendMessage(message) {
  // 画面には、自分が書いた文を、そのまま出す。AIに送る文だけ、個人情報に見える部分を伏せる
  const masked = KakekomiMask.maskPersonalInfo(message, maskKeepDigits());
  const turn = { role: "user", content: message };
  if (Object.keys(masked.found).length > 0) turn.masked = masked.found;
  session.history.push(turn);
  renderMessages();
  saveSession(session);
  showTypingIndicator();

  // これまでの会話と、いまの発言を、同じ番号の付け方で伏せる（同じ電話番号なら、同じ伏せ字）
  const conv = maskedConversation(session.history);
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...devHeaders() },
    body: JSON.stringify({
      message: conv.turns[conv.turns.length - 1].content,
      history: conv.turns.slice(0, -1),
      state: session.state,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    session.history.push({ role: "assistant", content: chatErrorMessage(res, data) });
    renderMessages();
    saveSession(session);
    return;
  }

  const data = await res.json();
  // sig は、サーバーが出した返信だという署名。履歴に戻して送るときに、サーバーが確かめる
  session.history.push({ role: "assistant", content: data.reply, sig: data.sig });
  session.state = data.state;
  // サーバーは「まだ提示していない候補」だけを返すので、上書きせず溜めていく
  session.lastCandidates = mergeCandidates(session.lastCandidates, data.candidateActions);
  renderMessages();
  renderNotes();
  saveSession(session);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autoGrow();
  updateMaskHint();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await sendMessage(text);
  } catch (err) {
    console.error(err);
    session.history.push({
      role: "assistant",
      content: "通信エラーが発生しました。少し時間をおいて、もう一度試してください。",
    });
    renderMessages();
    saveSession(session);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

// ---- 新しい相談を始める ----

function resetSession() {
  session = { history: [], state: null, lastCandidates: [], progress: {} };
  saveSession(session);
  renderMessages();
  renderNotes();
  input.value = "";
  autoGrow();
  input.focus();
}

newSessionButton.addEventListener("click", () => {
  if (session.history.length === 0) {
    resetSession();
    return;
  }
  if (
    confirm(
      "今の相談内容を消して、新しい相談を始めますか？この操作は取り消せません。残しておきたい場合は先に「相談内容を保存する」を使ってください。"
    )
  ) {
    resetSession();
  }
});

// ---- ログイン・新規登録 ----

const authForm = document.getElementById("auth-form");
const authLoginId = document.getElementById("auth-login-id");
const authDisplayName = document.getElementById("auth-display-name");
const authDisplayNameField = document.getElementById("auth-display-name-field");
const authPassword = document.getElementById("auth-password");
const authPasswordConfirm = document.getElementById("auth-password-confirm");
const authPasswordConfirmField = document.getElementById("auth-password-confirm-field");
const authShowPassword = document.getElementById("auth-show-password");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
let authMode = "register";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function passwordProblem(password) {
  if (password.length < 8) return "パスワードは8文字以上にしてください。";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "パスワードは英字と数字の両方を含めてください。";
  }
  return "";
}

function setPasswordVisible(visible) {
  const type = visible ? "text" : "password";
  authPassword.type = type;
  authPasswordConfirm.type = type;
}

authShowPassword.addEventListener("change", () => setPasswordVisible(authShowPassword.checked));

const authRecoveryField = document.getElementById("auth-recovery-field");
const authRecoveryCode = document.getElementById("auth-recovery-code");
const authPasswordLabel = document.getElementById("auth-password-label");
const authForgot = document.getElementById("auth-forgot");
const authBack = document.getElementById("auth-back");

// mode: "register"（新規登録） / "login"（ログイン） / "reset"（パスワード再設定）
function openAuthModal(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  const isReset = mode === "reset";
  const needsConfirm = isRegister || isReset;
  document.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
  authSubmit.textContent = isRegister ? "登録する" : isReset ? "パスワードを再設定する" : "ログインする";
  authPasswordLabel.textContent = isReset
    ? "新しいパスワード（8文字以上、英字と数字の両方を含める）"
    : "パスワード（8文字以上、英字と数字の両方を含める）";
  authDisplayNameField.hidden = !isRegister;
  authDisplayName.required = isRegister;
  authRecoveryField.hidden = !isReset;
  authRecoveryCode.required = isReset;
  document.getElementById("auth-email-note").hidden = !isRegister;
  document.getElementById("auth-recovery-note").hidden = !isRegister;
  authPasswordConfirmField.hidden = !needsConfirm;
  authPasswordConfirm.required = needsConfirm;
  authPassword.autocomplete = needsConfirm ? "new-password" : "current-password";
  authForgot.hidden = mode !== "login";
  authBack.hidden = !isReset;
  authError.hidden = true;
  authForm.reset();
  setPasswordVisible(false);
  openModal("auth-modal");
}

authForgot.addEventListener("click", () => openAuthModal("reset"));
authBack.addEventListener("click", () => openAuthModal("login"));

// ---- リカバリーコードの表示（登録直後・再設定直後。控えたと確認するまで閉じられない） ----

const recoveryCodeEl = document.getElementById("recovery-code");
const recoverySaved = document.getElementById("recovery-saved");
const recoveryClose = document.getElementById("recovery-close");
let recoveryContext = { email: "", afterClose: null };

function showRecoveryModal(code, { title, lead, email, afterClose }) {
  document.getElementById("recovery-title").textContent = title;
  document.getElementById("recovery-lead").textContent = lead;
  recoveryCodeEl.textContent = code;
  recoverySaved.checked = false;
  recoveryClose.disabled = true;
  recoveryContext = { email, afterClose };
  openModal("recovery-modal");
}

recoverySaved.addEventListener("change", () => {
  recoveryClose.disabled = !recoverySaved.checked;
});

recoveryClose.addEventListener("click", () => {
  closeModal("recovery-modal");
  const after = recoveryContext.afterClose;
  recoveryCodeEl.textContent = "";
  recoveryContext = { email: "", afterClose: null };
  if (after) after();
});

document.getElementById("recovery-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(recoveryCodeEl.textContent);
    alert("コピーしました。");
  } catch (e) {
    alert("自動でコピーできませんでした。コードをクリックして選択し、手動でコピーしてください。");
  }
});

document.getElementById("recovery-download").addEventListener("click", () => {
  const text = [
    "Kakekomi リカバリーコード",
    "",
    `メールアドレス: ${recoveryContext.email}`,
    `リカバリーコード: ${recoveryCodeEl.textContent}`,
    "",
    "パスワードを忘れたときに、このコードで再設定できます。",
    "他の人に見られない場所に保管してください。",
    "",
  ].join("\n");
  downloadFile("kakekomi-recovery-code.txt", text, "text/plain");
});

function authErrorMessage(res, data) {
  if (data.error === "login_locked") {
    return "ログインの失敗が続いたため、一時的に受け付けられません。1時間ほどあけてからお試しください。";
  }
  if (data.error === "reset_locked") {
    return "再設定の失敗が続いたため、一時的に受け付けられません。1時間ほどあけてからお試しください。";
  }
  if (res.status === 429) {
    return data.error === "registration_limit_reached"
      ? "このネットワークからの登録数が上限に達しています。"
      : "短時間に試行しすぎです。しばらく時間をおいてからもう一度お試しください。";
  }
  switch (data.error) {
    case "login_id_taken":
      return "そのメールアドレスはすでに登録されています。ログインをお試しください。";
    case "email_invalid":
      return "メールアドレスの形式で入力してください。";
    case "display_name_invalid":
      return "表示名は1〜50文字で入力してください。";
    case "invalid_credentials":
      return "メールアドレスまたはパスワードが正しくありません。";
    case "invalid_recovery":
      return "メールアドレスまたはリカバリーコードが正しくありません。";
    case "reset_locked":
      return "再設定の失敗が続いたため、一時的に受け付けられません。1時間ほどあけてからお試しください。";
    case "password_too_short":
      return "パスワードは8文字以上にしてください。";
    case "password_too_weak":
      return "パスワードは英字と数字の両方を含めてください。";
    case "password_common":
      return "このパスワードは、推測されやすいため使えません。ほかの文字や、長さを足して、別のものにしてください。";
    case "password_too_long":
      return "パスワードは128文字以内にしてください。";
    default:
      return "エラーが発生しました。もう一度お試しください。";
  }
}

document.querySelectorAll(".modal-tab").forEach((tab) => {
  tab.addEventListener("click", () => openAuthModal(tab.dataset.mode));
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  const isRegister = authMode === "register";
  const isReset = authMode === "reset";
  const loginId = authLoginId.value.trim();
  const displayName = authDisplayName.value.trim();
  const password = authPassword.value;

  if (isRegister || isReset) {
    const problem = !EMAIL_PATTERN.test(loginId)
      ? "メールアドレスの形式で入力してください。"
      : passwordProblem(password) || (password !== authPasswordConfirm.value ? "パスワードが一致しません。もう一度確認してください。" : "");
    if (problem) {
      authError.textContent = problem;
      authError.hidden = false;
      return;
    }
  }

  const path = isRegister ? "/api/register" : isReset ? "/api/password-reset" : "/api/login";
  const body = isRegister
    ? { login_id: loginId, display_name: displayName, password }
    : isReset
    ? { login_id: loginId, recovery_code: authRecoveryCode.value.trim(), new_password: password }
    : { login_id: loginId, password };

  authSubmit.disabled = true;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...devHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      authError.textContent = authErrorMessage(res, data);
      authError.hidden = false;
      return;
    }
    closeModal("auth-modal");

    if (isReset) {
      showRecoveryModal(data.recoveryCode, {
        title: "パスワードを再設定しました",
        lead: "新しいリカバリーコードを発行しました。これまでのコードは使えなくなりました。新しいコードを必ず保管してください。このあと、新しいパスワードでログインしてください。",
        email: loginId,
        afterClose: () => openAuthModal("login"),
      });
      return;
    }

    saveAccount({
      token: data.token,
      loginId: data.loginId,
      displayName: data.displayName,
    });

    if (isRegister) {
      showRecoveryModal(data.recoveryCode, {
        title: "登録が完了しました。リカバリーコードを保管してください",
        lead: "パスワードを忘れたときに、このコードで再設定できます。メールは送られないため、このコードを失くすとパスワードを再設定できません。",
        email: data.loginId,
        afterClose: null,
      });
    }
  } catch (err) {
    console.error(err);
    authError.textContent = "通信エラーが発生しました。ネットワークを確認してもう一度お試しください。";
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
  }
});

async function logout() {
  const current = account;
  saveAccount(null);
  if (!current) return;
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${current.token}`, ...devHeaders() },
    });
  } catch (e) {
    console.warn("logout request failed", e);
  }
}

// 保存済みのログイン状態が有効か確認する（期限切れ・サーバー側で失効済みなら解除）。
// 通信エラーのときは判断できないので、ログイン状態は維持する。
async function verifyAccount() {
  if (!account) return;
  try {
    const res = await authedFetch("/api/me");
    if (res.status === 401) {
      saveAccount(null);
      return;
    }
    if (res.ok) {
      const data = await res.json();
      saveAccount({ token: account.token, loginId: data.loginId, displayName: data.displayName });
    }
  } catch (e) {
    console.warn("failed to verify account", e);
  }
}

accountArea.addEventListener("click", (e) => {
  if (e.target.id === "login-open") openAuthModal("register");
  if (e.target.id === "logout-btn") logout();
});

// ---- 相談内容の保存（Markdownファイルとしてダウンロード） ----

const SUMMARY_FAILED_TEXT = "（要約の作成に失敗しました）";
const DATA_MARKER = "kakekomi-data:v1";

function toBase64(str) {
  let bin = "";
  new TextEncoder().encode(str).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function buildExportMarkdown(summary) {
  const dateStr = new Date().toLocaleString("ja-JP");
  const summaryText = summary || SUMMARY_FAILED_TEXT;
  const actionsText = (session.lastCandidates || [])
    .map((a) => {
      const mark = KakekomiSteps.STATUS_LABELS[KakekomiSteps.statusOf(session.progress, a.id)];
      return `- **${a.action}**（${mark}）\n  ${a.caveat}`;
    })
    .join("\n\n");
  // 続きから相談するときに、いまの状況カードと次の一歩、進み具合を元に戻すためのデータ（画面には出ない）
  const data = toBase64(
    JSON.stringify({
      state: session.state,
      candidates: session.lastCandidates || [],
      progress: session.progress || {},
    })
  );

  return [
    `# Kakekomi 相談記録`,
    ``,
    `保存日時: ${dateStr}`,
    `このファイルは、Kakekomiの「前回の相談の続きから始める」で読み込むと、続きから相談できます。`,
    ``,
    `## 要約`,
    ``,
    summaryText,
    ``,
    `## まとめノート`,
    ``,
    actionsText || "（まだ整理された行動指針はありません）",
    ``,
    `<!-- ${DATA_MARKER} ${data} -->`,
    ``,
  ].join("\n");
}

// ---- 保存したファイルの読み込み（前回の続きから相談する） ----

const IMPORT_FILE_MAX_BYTES = 300 * 1024;
// サーバーが1発言ごとに受け付ける長さ（HISTORY_ITEM_MAX=4000）に収まるようにする
const IMPORT_SUMMARY_MAX = 3200;

function parseExportMarkdown(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##[ \t]+要約[ \t]*$/.test(l));
  if (start === -1) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##[ \t]/.test(lines[i]) || lines[i].includes(`<!-- ${DATA_MARKER}`)) break;
    body.push(lines[i]);
  }
  const summary = body.join("\n").trim();
  if (!summary || summary === SUMMARY_FAILED_TEXT) return null;

  let state = null;
  let candidates = [];
  let progress = {};
  const m = text.match(new RegExp(`<!--\\s*${DATA_MARKER}\\s+([A-Za-z0-9+/=]+)\\s*-->`));
  if (m) {
    try {
      const data = JSON.parse(fromBase64(m[1]));
      const s = data && data.state;
      if (
        s &&
        typeof s === "object" &&
        s.personal && typeof s.personal === "object" &&
        s.business && typeof s.business === "object" &&
        Array.isArray(s.presented_actions) &&
        Array.isArray(s.already_consulted) &&
        JSON.stringify(s).length <= 20000
      ) {
        state = s;
      }
      if (state) {
        candidates = KakekomiSteps.sanitizeCandidates(data.candidates);
        progress = KakekomiSteps.sanitizeProgress(data.progress, candidates);
      }
    } catch (e) {
      console.warn("failed to read embedded data", e);
    }
  }
  return { summary: summary.slice(0, IMPORT_SUMMARY_MAX), state, candidates, progress };
}

const importFileInput = document.getElementById("import-file");

async function importConsultationFile(file) {
  const unreadable =
    "このファイルからは相談内容を読み取れませんでした。Kakekomiの「相談内容を保存する」で保存したファイル（.md）を選んでください。";
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    alert(unreadable);
    return;
  }
  let parsed = null;
  try {
    parsed = parseExportMarkdown(await file.text());
  } catch (e) {
    console.warn("failed to read file", e);
  }
  if (!parsed) {
    alert(unreadable);
    return;
  }
  if (
    session.history.length > 0 &&
    !confirm("今の相談内容は消えて、読み込んだ内容に置き換わります。よろしいですか？")
  ) {
    return;
  }

  // 前回の「次の一歩」の進み具合（やった／まだ／できなかった）を踏まえて、続きから聞く
  const resume = KakekomiSteps.resumeMessages(parsed.summary, parsed.candidates, parsed.progress);
  session = {
    history: [
      { role: "user", content: resume.userText },
      { role: "assistant", content: resume.assistantText },
    ],
    state: parsed.state,
    lastCandidates: parsed.candidates,
    progress: parsed.progress,
  };
  saveSession(session);
  renderMessages();
  renderNotes();
  input.focus();
}

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files && importFileInput.files[0];
  importFileInput.value = "";
  if (file) await importConsultationFile(file);
});

messagesEl.addEventListener("click", (e) => {
  if (e.target.id === "import-open") importFileInput.click();
});

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

exportNoteButton.addEventListener("click", async () => {
  if (session.history.length === 0) {
    alert("まだ会話がありません。相談を始めてから保存してください。");
    return;
  }
  exportNoteButton.disabled = true;
  exportNoteButton.textContent = "要約を作成しています…";

  let summary = "";
  try {
    const conv = maskedConversation(session.history);
    const res = await fetch(`${API_BASE}/api/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json", ...devHeaders() },
      body: JSON.stringify({ history: conv.turns }),
    });
    if (res.ok) {
      const data = await res.json();
      // 要約に伏せ字（〔電話番号1〕など）があれば、この端末の中で、元の値に戻す。
      // 窓口や専門家に出す要約から、連絡先などが消えないようにするため
      summary = restoreFromMap(data.summary || "", conv.map);
    }
  } catch (e) {
    console.error(e);
  } finally {
    exportNoteButton.disabled = false;
    exportNoteButton.textContent = "相談内容を保存する";
  }

  pendingSummary = summary;
  openModal("save-modal");
});

// ---- 保存方法の選択（ファイル / 印刷・PDF） ----

let pendingSummary = "";

document.getElementById("save-file").addEventListener("click", () => {
  const md = buildExportMarkdown(pendingSummary);
  const filename = `kakekomi-${new Date().toISOString().slice(0, 10)}.md`;
  downloadFile(filename, md, "text/markdown");
  closeModal("save-modal");
});

// 印刷用の紙面を作る。入力された内容は textContent で入れる（HTMLとして解釈させない）。
function buildPrintSheet(summary) {
  const sheet = document.getElementById("print-sheet");
  sheet.innerHTML = "";
  const add = (tag, text, className) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    sheet.appendChild(el);
    return el;
  };

  add("h1", "Kakekomi 相談メモ");
  add("p", `作成日: ${new Date().toLocaleDateString("ja-JP")}`, "print-meta");

  const { rows, flags } = situationRows(session.state);
  if (rows.length > 0 || flags.length > 0) {
    add("h2", "いまの状況");
    const dl = document.createElement("dl");
    for (const [k, v] of rows) {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      wrap.append(dt, dd);
      dl.appendChild(wrap);
    }
    sheet.appendChild(dl);
    if (flags.length > 0) add("p", flags.join(" / "), "print-flags");
  }

  add("h2", "相談の要約");
  add("p", summary || SUMMARY_FAILED_TEXT, "print-summary");

  const stageMap = window.KakekomiStageMap ? window.KakekomiStageMap.buildStageMap(session.state) : null;
  if (stageMap) {
    add("h2", "いまの位置（目安）");
    const here = stageMap.stages[stageMap.hereIndex];
    add("p", `${stageMap.title}\nいまここ: ${here.label}（${stageMap.approx ? "目安" : "通知の内容から"}）`, "print-summary");
    add("p", stageMap.options.map((t) => `・${t}`).join("\n"), "print-summary");
  }

  const candidates = session.lastCandidates || [];
  if (candidates.length > 0) {
    add("h2", "次の一歩（候補）");
    for (const c of candidates) {
      const item = document.createElement("div");
      item.className = "print-step";
      const a = document.createElement("p");
      a.className = "print-step-action";
      const mark = KakekomiSteps.STATUS_LABELS[KakekomiSteps.statusOf(session.progress, c.id)];
      a.textContent = `［${mark}］${c.action}`;
      const b = document.createElement("p");
      b.textContent = c.caveat;
      item.append(a, b);
      if (c.source && KakekomiSteps.isTrustedSourceUrl(c.source.url)) {
        const s = document.createElement("p");
        s.className = "print-source";
        s.textContent = `根拠: ${c.source.label}（${c.source.url}${c.source.verifiedAt ? `、確認日 ${c.source.verifiedAt}` : ""}）`;
        item.appendChild(s);
      }
      sheet.appendChild(item);
    }
  }

  const script = currentCallScript();
  if (script) {
    add("h2", script.title);
    add("p", script.text, "print-script");
  }

  add(
    "p",
    "この内容は、AIが会話をもとに整理したものです。法律・税務などの専門的な助言ではなく、誤りが含まれることがあります。制度や金額は、必ず窓口や専門家に確認してください。",
    "print-note"
  );
}

document.getElementById("save-print").addEventListener("click", () => {
  buildPrintSheet(pendingSummary);
  closeModal("save-modal");
  window.print();
});

// ---- 資金繰りチェック（経営者向け） ----
// 数字も取引先名も、このブラウザの中だけで計算する（通信しない）。画面には本名のまま出す。
// 画面の外に出るもの（AIに相談する文・印刷/PDF）だけ、名前を入れない／伏せられるようにしている。

const CF_KEY = "kakekomi_cashflow_v1";
const cfModal = document.getElementById("cashflow-modal");
const cfForm = document.getElementById("cashflow-form");
const cfResultEl = document.getElementById("cashflow-result");
const cfRecvRows = document.getElementById("cf-recv-rows");
const cfPayRows = document.getElementById("cf-pay-rows");
const cfSave = document.getElementById("cf-save");
const cashflowNoteButton = document.getElementById("cashflow-open-note");

const CF_KIND_OPTIONS = [
  ["supplier", "仕入・外注"],
  ["rent", "家賃・リース"],
  ["other", "その他の支払い"],
  ["loan", "借入の返済"],
  ["tax", "税金・社会保険料"],
  ["payroll", "給与"],
];
const CF_REL_OPTIONS = [
  ["good", "相談しやすい"],
  ["normal", "ふつう"],
  ["hard", "相談しにくい"],
];
const CF_IMPACT_OPTIONS = [
  ["replaceable", "止まっても代わりがある"],
  ["critical", "止まると事業が回らない"],
];
const CF_FIELDS = ["cash", "payroll", "rent", "debt", "tax", "other", "in1", "in2", "in3"];

function cfNode(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function cfInput(type, name, placeholder, value, extra = {}) {
  const el = document.createElement("input");
  el.type = type;
  el.dataset.field = name;
  el.placeholder = placeholder;
  if (type === "number") {
    el.inputMode = "decimal";
    el.min = "0";
    el.step = "0.1";
  }
  if (value !== undefined && value !== null && value !== "") el.value = value;
  Object.assign(el, extra);
  return el;
}

function cfSelect(name, options, value) {
  const el = document.createElement("select");
  el.dataset.field = name;
  for (const [v, label] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    if (v === value) o.selected = true;
    el.appendChild(o);
  }
  return el;
}

function cfRemoveButton(row) {
  const b = cfNode("button", "cf-remove", "×");
  b.type = "button";
  b.setAttribute("aria-label", "この行を消す");
  b.addEventListener("click", () => row.remove());
  return b;
}

function addRecvRow(v = {}) {
  if (cfRecvRows.children.length >= KakekomiCashflow.MAX_IMPORT) return;
  const row = cfNode("div", "cf-row cf-recv");
  row.append(
    cfInput("text", "name", "取引先名（略称でOK）", v.name, { maxLength: 40 }),
    cfInput("number", "amount", "金額（万円）", v.amount),
    cfInput("number", "lateDays", "遅れ（日）", v.lateDays),
    cfRemoveButton(row)
  );
  cfRecvRows.appendChild(row);
}

function addPayRow(v = {}) {
  if (cfPayRows.children.length >= KakekomiCashflow.MAX_IMPORT) return;
  const row = cfNode("div", "cf-row cf-pay");
  row.append(
    cfInput("text", "name", "支払い先（略称でOK）", v.name, { maxLength: 40 }),
    cfInput("number", "amount", "金額（万円）", v.amount),
    cfInput("number", "dueDays", "期日まで（日）", v.dueDays),
    cfSelect("kind", CF_KIND_OPTIONS, v.kind || "supplier"),
    cfSelect("rel", CF_REL_OPTIONS, v.rel || "normal"),
    cfSelect("impact", CF_IMPACT_OPTIONS, v.impact || "replaceable"),
    cfRemoveButton(row)
  );
  cfPayRows.appendChild(row);
}

function readRows(container) {
  return [...container.children].map((row) => {
    const o = {};
    row.querySelectorAll("[data-field]").forEach((el) => (o[el.dataset.field] = el.value));
    return o;
  });
}

function readCashflowForm() {
  const input = {};
  for (const f of CF_FIELDS) input[f] = cfForm.elements[f].value;
  input.recv = readRows(cfRecvRows);
  input.pay = readRows(cfPayRows);
  return input;
}

function fillCashflowForm(input) {
  for (const f of CF_FIELDS) cfForm.elements[f].value = input[f] ?? "";
  cfRecvRows.innerHTML = "";
  cfPayRows.innerHTML = "";
  (input.recv || []).forEach(addRecvRow);
  (input.pay || []).forEach(addPayRow);
  if (cfRecvRows.children.length === 0) addRecvRow();
  if (cfPayRows.children.length === 0) addPayRow();
}

// 保存を選んだときだけ、このブラウザに保存する。取引先名は保存しない。
function saveCashflowInput(input) {
  try {
    if (!cfSave.checked) {
      localStorage.removeItem(CF_KEY);
      return;
    }
    const strip = (rows) => rows.map((r) => ({ ...r, name: "" }));
    localStorage.setItem(CF_KEY, JSON.stringify({ ...input, recv: strip(input.recv), pay: strip(input.pay) }));
  } catch (e) {
    console.warn("failed to save cashflow input", e);
  }
}

function loadSavedCashflowInput() {
  try {
    const raw = localStorage.getItem(CF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function showCashflowForm() {
  cfForm.hidden = false;
  cfResultEl.hidden = true;
}

function openCashflow() {
  const saved = loadSavedCashflowInput();
  cfSave.checked = !!saved;
  fillCashflowForm(saved || {});
  showCashflowForm();
  openModal("cashflow-modal");
}

function cfName(kind, item, masked) {
  return masked ? KakekomiCashflow.labelOf(kind, item.idx) : item.name;
}

function cfPlan(input, masked) {
  const result = KakekomiCashflow.compute(input);
  const plan = KakekomiCashflow.buildPlan(result, input.recv, resourcesCache, input.pay, {
    nameOf: (kind, item) => cfName(kind, item, masked),
  });
  return { result, plan };
}

function renderCashflowResult(input) {
  const { result, plan } = cfPlan(input, false); // 画面は、本名のまま
  const man = KakekomiCashflow.formatMan;
  cfResultEl.innerHTML = "";
  const add = (el) => (cfResultEl.appendChild(el), el);

  if (result.severity === "empty") {
    add(cfNode("p", "cf-banner cf-empty", "数字を入れてください。手元の資金と、毎月の支出、入金の見込みが分かると、試算できます。"));
    const back = add(cfNode("button", "modal-cancel", "入力に戻る"));
    back.type = "button";
    back.addEventListener("click", showCashflowForm);
    cfForm.hidden = true;
    cfResultEl.hidden = false;
    return;
  }

  add(cfNode("p", `cf-banner cf-${result.severity}`, plan.headline));

  const table = add(cfNode("table", "cf-table"));
  const head = table.createTHead().insertRow();
  ["月", "入金", "支出", "月末の残高"].forEach((t) => head.appendChild(cfNode("th", "", t)));
  const body = table.createTBody();
  const base = body.insertRow();
  base.appendChild(cfNode("td", "", "いま"));
  base.appendChild(cfNode("td", "", ""));
  base.appendChild(cfNode("td", "", ""));
  base.appendChild(cfNode("td", "", `${man(result.cash)}万円`));
  for (const m of result.months) {
    const tr = body.insertRow();
    tr.appendChild(cfNode("td", "", `${m.month}か月後`));
    tr.appendChild(cfNode("td", "", `${man(m.inflow)}万円`));
    tr.appendChild(cfNode("td", "", `${man(m.outflow)}万円`));
    tr.appendChild(cfNode("td", m.balance < 0 ? "cf-neg" : "", `${man(m.balance)}万円`));
  }

  add(cfNode("h4", "cf-h", "次の一歩"));
  for (const s of plan.steps) {
    const card = add(cfNode("div", "sticky"));
    card.appendChild(cfNode("p", "action", s.action));
    card.appendChild(cfNode("p", "caveat", s.caveat));
  }

  if (plan.collect.length > 0) {
    add(cfNode("h4", "cf-h", "入金を早めたい取引先の順番"));
    const ol = add(cfNode("ol", "cf-list"));
    for (const c of plan.collect) {
      const late = c.lateDays > 0 ? `${c.lateDays}日遅れ` : "遅れなし";
      ol.appendChild(cfNode("li", "", `${c.name}（約${man(c.amount)}万円・${late}）`));
    }
  }

  if (plan.defer.ranked.length > 0) {
    add(cfNode("h4", "cf-h", "支払いの猶予を相談する順番"));
    const ol = add(cfNode("ol", "cf-list cf-defer"));
    for (const r of plan.defer.ranked) {
      const li = cfNode("li");
      li.appendChild(cfNode("strong", "", `${r.name}`));
      li.appendChild(cfNode("span", "cf-meta", `（${r.kindLabel}・約${man(r.amount)}万円・期日まで${r.dueDays}日）`));
      if (r.reasons.length > 0) {
        const chips = cfNode("div", "cf-chips");
        r.reasons.forEach((t) => chips.appendChild(cfNode("span", "cf-chip", t)));
        li.appendChild(chips);
      }
      li.appendChild(cfNode("p", "cf-approach", r.approach));
      if (r.caution) li.appendChild(cfNode("p", "cf-caution", r.caution));
      ol.appendChild(li);
    }
  }
  if (plan.defer.routed.length > 0) {
    add(cfNode("h4", "cf-h", "取引先への猶予の対象にしない支払い"));
    const ul = add(cfNode("ul", "cf-list"));
    for (const r of plan.defer.routed) {
      ul.appendChild(cfNode("li", "", `${r.name}（${r.kindLabel}・約${man(r.amount)}万円）: ${r.advice}`));
    }
  }

  add(
    cfNode(
      "p",
      "modal-note",
      "簡易の試算です。法律・税務などの専門的な助言ではありません。入力した数字と取引先名は、このブラウザの中だけで扱い、サーバーにもAIにも送っていません。"
    )
  );

  const maskLabel = add(cfNode("label", "modal-check"));
  const mask = document.createElement("input");
  mask.type = "checkbox";
  mask.id = "cf-mask-print";
  maskLabel.append(mask, document.createTextNode("印刷・PDFでは、取引先名を伏せる（売掛先A・支払先B…と表示）"));

  const actions = add(cfNode("div", "cf-actions"));
  const printBtn = cfNode("button", "modal-cancel", "印刷・PDFにする");
  printBtn.type = "button";
  printBtn.addEventListener("click", () => printCashflow(input, mask.checked));
  const askBtn = cfNode("button", "modal-primary", "この結果をもとに相談する");
  askBtn.type = "button";
  askBtn.addEventListener("click", () => {
    // AIに送る文には、取引先名を入れない（合計の数字だけ）
    input_message_from_cashflow(result, plan);
  });
  const backBtn = cfNode("button", "modal-cancel", "入力を直す");
  backBtn.type = "button";
  backBtn.addEventListener("click", showCashflowForm);
  actions.append(backBtn, printBtn, askBtn);

  cfForm.hidden = true;
  cfResultEl.hidden = false;
  cfResultEl.scrollTop = 0;
  cfModal.querySelector(".modal").scrollTop = 0;
}

function input_message_from_cashflow(result, plan) {
  const man = KakekomiCashflow.formatMan;
  const text = `資金繰りチェックの結果です。手元の資金は約${man(result.cash)}万円、毎月の支出は約${man(result.outTotal)}万円で、${plan.headline}。何から手をつければいいですか。`;
  closeModal("cashflow-modal");
  input.value = text;
  autoGrow();
  input.focus();
}

function printCashflow(formInput, masked) {
  const { result, plan } = cfPlan(formInput, masked);
  const man = KakekomiCashflow.formatMan;
  const sheet = document.getElementById("print-sheet");
  sheet.innerHTML = "";
  const add = (tag, text, className) => {
    const el = cfNode(tag, className, text);
    sheet.appendChild(el);
    return el;
  };
  add("h1", "資金繰りチェック");
  add("p", `作成日: ${new Date().toLocaleDateString("ja-JP")}${masked ? "（取引先名は伏せています）" : ""}`, "print-meta");
  add("h2", "結果");
  add("p", plan.headline, "print-summary");

  const table = document.createElement("table");
  table.className = "print-table";
  const head = table.createTHead().insertRow();
  ["月", "入金", "支出", "月末の残高"].forEach((t) => head.appendChild(cfNode("th", "", t)));
  const body = table.createTBody();
  const base = body.insertRow();
  ["いま", "", "", `${man(result.cash)}万円`].forEach((t) => base.appendChild(cfNode("td", "", t)));
  for (const m of result.months) {
    const tr = body.insertRow();
    [`${m.month}か月後`, `${man(m.inflow)}万円`, `${man(m.outflow)}万円`, `${man(m.balance)}万円`].forEach((t) =>
      tr.appendChild(cfNode("td", "", t))
    );
  }
  sheet.appendChild(table);

  add("h2", "次の一歩（候補）");
  for (const s of plan.steps) {
    const item = cfNode("div", "print-step");
    item.appendChild(cfNode("p", "print-step-action", s.action));
    item.appendChild(cfNode("p", "", s.caveat));
    sheet.appendChild(item);
  }
  if (plan.collect.length > 0) {
    add("h2", "入金を早めたい取引先の順番");
    plan.collect.forEach((c, i) =>
      add("p", `${i + 1}. ${cfName("recv", c, masked)}（約${man(c.amount)}万円・${c.lateDays > 0 ? `${c.lateDays}日遅れ` : "遅れなし"}）`, "print-line")
    );
  }
  if (plan.defer.ranked.length > 0) {
    add("h2", "支払いの猶予を相談する順番");
    plan.defer.ranked.forEach((r, i) => {
      add("p", `${i + 1}. ${cfName("pay", r, masked)}（${r.kindLabel}・約${man(r.amount)}万円・期日まで${r.dueDays}日）${r.reasons.length ? ` — ${r.reasons.join("、")}` : ""}`, "print-line");
      add("p", r.approach, "print-line-sub");
    });
  }
  add("p", "簡易の試算です。法律・税務などの専門的な助言ではありません。数字は入力された内容にもとづき、確認は専門家や窓口に委ねてください。", "print-note");
  window.print();
}

// 表から貼り付けて取り込む（ブラウザの中だけで処理する）
function importPasted(kind, textOverride) {
  const isRecv = kind === "recv";
  const ta = document.getElementById(isRecv ? "cf-recv-paste" : "cf-pay-paste");
  const unit = document.getElementById(isRecv ? "cf-recv-unit" : "cf-pay-unit").value;
  const { rows, ignored } = KakekomiCashflow.parsePasted(textOverride !== undefined ? textOverride : ta.value, kind, unit);
  if (rows.length === 0) {
    alert("取り込める行がありませんでした。1行ごとに「名前・金額・日数」の順で、金額が数字になっているか確認してください。");
    return;
  }
  const container = isRecv ? cfRecvRows : cfPayRows;
  container.innerHTML = "";
  rows.forEach(isRecv ? addRecvRow : addPayRow);
  ta.value = "";
  if (ignored > 0) alert(`${KakekomiCashflow.MAX_IMPORT}件までを取り込みました。残りの${ignored}件は取り込んでいません。`);
}

cfForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const formInput = readCashflowForm();
  saveCashflowInput(formInput);
  renderCashflowResult(formInput);
});
// CSVファイル: ブラウザの中で読み、サーバーには送らない。大きすぎるファイルは読まない。
const CF_FILE_MAX_BYTES = 1024 * 1024;
for (const [id, kind] of [["cf-recv-file", "recv"], ["cf-pay-file", "pay"]]) {
  const fileInput = document.getElementById(id);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > CF_FILE_MAX_BYTES) {
      alert("ファイルが大きすぎます（1MBまで）。必要な行だけにして、もう一度選んでください。");
      return;
    }
    try {
      importPasted(kind, KakekomiCashflow.decodeText(await file.arrayBuffer()));
    } catch (e) {
      console.warn("failed to read csv", e);
      alert("ファイルを読み込めませんでした。CSV形式（.csv）か、タブ区切りの文字ファイルを選んでください。");
    }
  });
}
document.getElementById("cf-add-recv").addEventListener("click", () => addRecvRow());
document.getElementById("cf-add-pay").addEventListener("click", () => addPayRow());
document.getElementById("cf-recv-import").addEventListener("click", () => importPasted("recv"));
document.getElementById("cf-pay-import").addEventListener("click", () => importPasted("pay"));
document.getElementById("cf-clear").addEventListener("click", () => {
  try {
    localStorage.removeItem(CF_KEY);
  } catch (e) {
    /* 保存できない環境では何もしない */
  }
  cfSave.checked = false;
  fillCashflowForm({});
});
cashflowNoteButton.addEventListener("click", openCashflow);
messagesEl.addEventListener("click", (e) => {
  if (e.target.id === "cashflow-open") openCashflow();
});

// ---- 初期化 ----

renderMessages();
renderNotes();
autoGrow();
renderAccountUI();
verifyAccount();
loadResources();
