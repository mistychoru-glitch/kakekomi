// 匿名利用がデフォルト。会話履歴・構造化状態はブラウザのlocalStorageのみに保持し、
// サーバー（D1）には一切書き込まない（引き継ぎ資料 7-3章由来のルール）。

const API_BASE = window.KAKEKOMI_API_BASE || "http://127.0.0.1:8787";
const STORAGE_KEY = "kakekomi_guest_session_v1";

const messagesEl = document.getElementById("messages");
const notesEl = document.getElementById("notes");
const form = document.getElementById("composer");
const input = document.getElementById("input");

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("failed to load session", e);
  }
  return { history: [], state: null, lastCandidates: [] };
}

function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    console.warn("failed to save session", e);
  }
}

let session = loadSession();

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

async function sendMessage(message) {
  session.history.push({ role: "user", content: message });
  renderMessages();
  saveSession(session);

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await sendMessage(text);
  } catch (err) {
    console.error(err);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

renderMessages();
renderNotes();
