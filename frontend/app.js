// 会話履歴・構造化状態は常にブラウザのlocalStorageのみに保持し、サーバー（D1）には
// 一切書き込まない。学校のレギュレーション、および機密情報を保管するリスクを踏まえて、
// 会話内容そのものはサーバーに一切保存しない方針とした（ログイン機能のみ提供）。
// 残しておきたい場合は「相談内容を書き出す」でMarkdownファイルとしてダウンロードする。

const API_BASE = window.KAKEKOMI_API_BASE || "http://127.0.0.1:8787";
const STORAGE_KEY = "kakekomi_guest_session_v1";
const ACCOUNT_KEY = "kakekomi_account_v1";
const DEV_KEY_STORAGE = "kakekomi_dev_key";

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

function renderMessages() {
  messagesEl.innerHTML = "";
  for (const turn of session.history) {
    const div = document.createElement("div");
    div.className = `msg ${turn.role}`;
    div.textContent = turn.content;
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderNotes() {
  const candidates = session.lastCandidates || [];
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
  const planLabel =
    account.planStatus === "guest" ? "無料登録" : account.planStatus === "retain" ? "保持プラン" : "相談再開プラン";
  accountArea.innerHTML = `
    <span>${escapeHtml(account.displayName)}さん</span>
    <span class="plan-badge">${planLabel}</span>
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
    if (e.target === overlay || e.target.hasAttribute("data-close")) {
      overlay.hidden = true;
    }
  });
});

// ---- チャット送信 ----

function autoGrow() {
  input.style.height = "auto";
  const max = window.innerHeight * 0.4;
  input.style.height = Math.min(input.scrollHeight, max) + "px";
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
    session.history.push({
      role: "assistant",
      content: "通信エラーが発生しました。少し時間をおいて、もう一度試してください。",
    });
    renderMessages();
    saveSession(session);
    return;
  }

  const data = await res.json();
  session.history.push({ role: "assistant", content: data.reply });
  session.state = data.state;
  session.lastCandidates = data.candidateActions || [];
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
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
let authMode = "register";

function openAuthModal(mode) {
  authMode = mode;
  document.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
  authSubmit.textContent = mode === "register" ? "登録する" : "ログインする";
  authDisplayNameField.hidden = mode === "login";
  authDisplayName.required = mode === "register";
  authError.hidden = true;
  authForm.reset();
  openModal("auth-modal");
}

document.querySelectorAll(".modal-tab").forEach((tab) => {
  tab.addEventListener("click", () => openAuthModal(tab.dataset.mode));
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  const loginId = authLoginId.value.trim();
  const displayName = authDisplayName.value.trim();
  const password = authPassword.value;
  const path = authMode === "register" ? "/api/register" : "/api/login";
  const body =
    authMode === "register"
      ? { login_id: loginId, display_name: displayName, password }
      : { login_id: loginId, password };

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...devHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      authError.textContent =
        data.error === "login_id_taken"
          ? "そのログインIDはすでに使われています。"
          : data.error === "login_id_invalid"
          ? "ログインIDは半角英数字とアンダースコアで3〜20文字にしてください。"
          : data.error === "invalid_credentials"
          ? "ログインIDまたはパスワードが正しくありません。"
          : data.error === "password_too_short"
          ? "パスワードは8文字以上にしてください。"
          : "エラーが発生しました。もう一度お試しください。";
      authError.hidden = false;
      return;
    }
    saveAccount({
      token: data.token,
      loginId: data.loginId,
      displayName: data.displayName,
      planStatus: data.planStatus,
    });
    closeModal("auth-modal");
  } catch (err) {
    console.error(err);
    authError.textContent = "通信エラーが発生しました。";
    authError.hidden = false;
  }
});

accountArea.addEventListener("click", (e) => {
  if (e.target.id === "login-open") openAuthModal("register");
  if (e.target.id === "logout-btn") {
    saveAccount(null);
  }
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

function downloadMarkdown(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
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
  downloadMarkdown(filename, md);
});

// ---- 初期化 ----

renderMessages();
renderNotes();
autoGrow();
renderAccountUI();
