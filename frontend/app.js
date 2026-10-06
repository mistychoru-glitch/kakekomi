// 会話履歴・構造化状態は常にブラウザのlocalStorageのみに保持し、サーバー（D1）には
// 一切書き込まない。学校のレギュレーション、および機密情報を保管するリスクを踏まえて、
// 会話内容そのものはサーバーに一切保存しない方針とした（ログイン機能のみ提供）。
// 残しておきたい場合は「相談内容を書き出す」でMarkdownファイルとしてダウンロードする。

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

// ---- 会話セッション（chat）の状態 ----

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("failed to load session", e);
  }
  return { history: [], state: null, lastCandidates: [] };
}

function saveSession(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("failed to save session", e);
  }
}

let session = loadSession();

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

const EXAMPLE_PROMPTS = [
  "家賃を滞納してしまい、大家さんから督促状が届きました",
  "借金の返済が苦しくて、毎月の支払いに追われています",
  "収入が減って、今の家賃を払い続けられるか不安です",
  "事業の資金繰りが厳しく、来月の支払いが心配です",
];

function renderWelcome() {
  const wrap = document.createElement("div");
  wrap.className = "welcome";
  wrap.innerHTML = `
    <p class="welcome-lead">ここは、お金の悩みを安心して話せる場所です。</p>
    <p class="welcome-sub">うまく書けなくても大丈夫です。思いつくままに書いてください。<br>下の例を選んで、書き換えて送ることもできます。</p>
  `;
  const list = document.createElement("div");
  list.className = "welcome-examples";
  for (const text of EXAMPLE_PROMPTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "example-chip";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      input.value = text;
      autoGrow();
      input.focus();
    });
    list.appendChild(btn);
  }
  wrap.appendChild(list);
  messagesEl.appendChild(wrap);
}

function renderMessages() {
  messagesEl.innerHTML = "";
  if (session.history.length === 0) {
    renderWelcome();
    return;
  }
  for (const turn of session.history) {
    const div = document.createElement("div");
    div.className = `msg ${turn.role}`;
    div.textContent = turn.content;
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- 「いまの状況」カード（会話から読み取れた内容を、サーバーに送った状態から表示する） ----

const THEME_LABELS = {
  housing: "住まい・家賃",
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

async function loadResources() {
  const listEl = document.getElementById("resources-list");
  try {
    const res = await fetch(`${API_BASE}/api/resources`, { headers: devHeaders() });
    if (!res.ok) throw new Error("failed");
    const { resources } = await res.json();
    listEl.innerHTML = resources
      .map((r) => {
        const phone = r.phone
          ? `<p class="resource-phone"><a href="tel:${escapeHtml(r.phone.replace(/[^0-9]/g, ""))}">${escapeHtml(r.phone)}</a>${r.hours ? `<span>${escapeHtml(r.hours)}</span>` : ""}</p>`
          : "";
        const how = r.howToFind ? `<p class="resource-how">${escapeHtml(r.howToFind)}</p>` : "";
        return `<div class="resource"><p class="resource-name">${escapeHtml(r.name)}</p>${phone}<p class="resource-does">${escapeHtml(r.whatTheyDo)}</p>${how}</div>`;
      })
      .join("");
  } catch (e) {
    console.warn("failed to load resources", e);
    listEl.innerHTML = '<p class="notes-empty">相談窓口の一覧を読み込めませんでした。</p>';
  }
}

function renderNotes() {
  renderSituation();
  const candidates = session.lastCandidates || [];
  document.getElementById("notes-heading").hidden = candidates.length === 0;
  if (candidates.length === 0) {
    notesEl.innerHTML =
      '<p class="notes-empty">会話が進むと、ここに整理された内容が付箋のように表示されます。</p>';
    return;
  }
  notesEl.innerHTML = "";
  for (const c of candidates) {
    const div = document.createElement("div");
    div.className = "sticky";
    div.innerHTML = `<p class="action">${escapeHtml(c.action)}</p><p class="caveat">${escapeHtml(c.caveat)}</p>`;
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

input.addEventListener("input", autoGrow);

input.addEventListener("keydown", (e) => {
  // Enterで送信、Shift+Enterで改行（Mac/Windows共通の一般的なチャットUIの挙動）。
  // 日本語入力の変換確定Enter（isComposing / keyCode 229）は送信扱いにしない。
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

async function sendMessage(message) {
  session.history.push({ role: "user", content: message });
  renderMessages();
  saveSession(session);
  showTypingIndicator();

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...devHeaders() },
    body: JSON.stringify({
      message,
      history: session.history.slice(0, -1),
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
  session.history.push({ role: "assistant", content: data.reply });
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
  session = { history: [], state: null, lastCandidates: [] };
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
      "今の相談内容を消して、新しい相談を始めますか？この操作は取り消せません。残しておきたい場合は先に「相談内容を書き出す」を使ってください。"
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

// ---- 相談内容の書き出し（Markdownファイルとしてダウンロード） ----

function buildExportMarkdown(summary) {
  const dateStr = new Date().toLocaleString("ja-JP");
  const summaryText = summary || "（要約の作成に失敗しました）";
  const actionsText = (session.lastCandidates || [])
    .map((a) => `- **${a.action}**\n  ${a.caveat}`)
    .join("\n\n");

  return [
    `# Kakekomi 相談記録`,
    ``,
    `書き出し日時: ${dateStr}`,
    ``,
    `## 要約`,
    ``,
    summaryText,
    ``,
    `## まとめノート`,
    ``,
    actionsText || "（まだ整理された行動指針はありません）",
    ``,
  ].join("\n");
}

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
    alert("まだ会話がありません。相談を始めてから書き出してください。");
    return;
  }
  exportNoteButton.disabled = true;
  exportNoteButton.textContent = "要約を作成しています…";

  let summary = "";
  try {
    const res = await fetch(`${API_BASE}/api/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json", ...devHeaders() },
      body: JSON.stringify({ history: session.history }),
    });
    if (res.ok) {
      const data = await res.json();
      summary = data.summary || "";
    }
  } catch (e) {
    console.error(e);
  } finally {
    exportNoteButton.disabled = false;
    exportNoteButton.textContent = "相談内容を書き出す";
  }

  const md = buildExportMarkdown(summary);
  const filename = `kakekomi-${new Date().toISOString().slice(0, 10)}.md`;
  downloadFile(filename, md, "text/markdown");
});

// ---- 初期化 ----

renderMessages();
renderNotes();
autoGrow();
renderAccountUI();
verifyAccount();
loadResources();
