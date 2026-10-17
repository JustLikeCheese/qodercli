import { createConversationStream } from '/helpers/conversation-stream.mjs';

const $ = id => document.getElementById(id);
const base = '/functions/v1/app/api/chat';
const terminal = state => ['completed', 'failed', 'interrupted'].includes(state);
const busy = state => ['running', 'pending'].includes(state);
const drafts = new Map(), intents = new Map();
let activeId, current, view = 0, connection, listVersion = 0, mode, recoveryNotice, creation, firstSend, sending = false, ready = false;
let conversationItems = [];
const errorText = {
  chat_not_configured: '对话服务尚未接入。请先配置服务端会话与持久化适配器；当前不会调用 AI。',
  login_required: '请先登录，再继续这段对话。', forbidden: '你暂时不能访问这段对话。',
  not_found: '这段对话已不可用。本地服务重启后，演示历史会清空。',
  conversation_busy: '上一条消息还在处理中，可以等待或先停止回复。',
  request_conflict: '请求状态存在冲突，请先恢复会话状态。',
  invalid_request: '消息格式有误，请检查后再发送。', payload_too_large: '消息太长了，请缩短后发送。',
  dispatch_unknown: '发送结果暂时未知，正在恢复状态。不会自动重发这条消息。',
  service_unavailable: '服务暂时不可用，输入已保留。请稍后恢复状态。',
};
const notice = text => { $('notice').textContent = text || ''; $('notice').hidden = !text; };
const status = (text, kind = '') => { $('connection-label').textContent = text; $('connection-dot').className = kind; };
async function json(path, options = {}) {
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 20_000);
  try {
    const response = await fetch(`${base}${path}`, { credentials: 'same-origin', ...options, signal: abort.signal });
    if (!response.headers.get('content-type')?.includes('application/json')) throw Object.assign(Error('service_unavailable'), { code: 'service_unavailable' });
    const result = await response.json();
    if (!response.ok || result.error) throw Object.assign(Error(result.error?.code || 'service_unavailable'), { code: result.error?.code || 'service_unavailable', status: response.status });
    return result;
  } finally { clearTimeout(timeout); }
}
const post = (path, value, requestId, extraHeaders = {}) => json(path, { method: 'POST', headers: {
  'content-type': 'application/json', 'idempotency-key': requestId, ...extraHeaders,
}, body: JSON.stringify(value) });

function renderList() {
  const list = $('conversation-list'); list.replaceChildren();
  $('conversation-count').textContent = String(conversationItems.length);
  if (!conversationItems.length) { const p = document.createElement('p'); p.className = 'list-empty'; p.textContent = '从第一段对话开始。'; list.append(p); }
  for (const item of conversationItems) {
    const button = document.createElement('button'); button.className = `conversation-item${item.id === activeId ? ' active' : ''}`;
    button.setAttribute('aria-current', item.id === activeId ? 'true' : 'false');
    const title = document.createElement('span'); title.textContent = item.title; button.append(title);
    button.onclick = () => selectConversation(item.id); list.append(button);
  }
}
async function refreshList() {
  const version = ++listVersion;
  try { const result = await json('/conversations'); if (version === listVersion) { conversationItems = result.conversations; renderList(); } }
  catch { if (version === listVersion && ready) notice('会话列表暂时没有刷新，当前消息仍保留。'); }
}
function render() {
  $('conversation-title').textContent = current?.title || '新的对话';
  $('welcome').hidden = Boolean(current?.messages.length);
  const timeline = $('timeline'), keepBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 100;
  $('messages').replaceChildren();
  for (const message of current?.messages || []) {
    const row = document.createElement('article'); row.className = `message ${message.role}`;
    const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = message.role === 'user' ? '你' : '✳'; avatar.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div'); content.className = 'message-content';
    const label = document.createElement('div'); label.className = 'message-label'; label.textContent = message.role === 'user' ? '你' : mode === 'local-demo' ? '澄光 · 本地受控回复' : '澄光';
    const text = document.createElement('div'); text.className = `message-text${message.state === 'running' ? ' typing' : ''}`;
    text.textContent = message.text || (message.state === 'pending' ? '正在确认消息状态…' : message.state === 'running' ? '正在准备回复…' : '');
    content.append(label, text);
    if (['failed', 'interrupted'].includes(message.state)) { const state = document.createElement('div'); state.className = 'message-state'; state.textContent = message.state === 'failed' ? '回复中断 · 已保留现有内容，未自动重发' : '已停止 · 可以继续发送新消息'; content.append(state); }
    row.append(avatar, content); $('messages').append(row);
  }
  const createUnknown = !activeId && creation?.outcome === 'unknown';
  const unknown = intents.get(activeId)?.outcome === 'unknown' || current?.state === 'pending' || createUnknown;
  $('send').disabled = !ready || sending || busy(current?.state) || unknown || !$('prompt').value.trim();
  $('stop').hidden = !busy(current?.state) || !current?.runId;
  $('activity').textContent = createUnknown ? '正在确认新对话状态' : unknown ? '正在确认发送结果' : sending ? '正在发送…' : ({ running: '正在逐步回复…', pending: '等待确认，可恢复状态', completed: '回复完成', interrupted: '回复已停止', failed: '回复失败，内容已保留' }[current?.state] || '准备好开始了');
  $('recover').hidden = !unknown && connection?.state !== 'offline';
  if (keepBottom) timeline.scrollTop = timeline.scrollHeight;
}
function apply(value, expectedView) {
  if (view !== expectedView || value.id !== activeId || current && value.revision < current.revision) return;
  current = value;
  const intent = intents.get(activeId);
  if (intent && intent.requestId === value.requestId) {
    // The application request ID, not matching prompt text, establishes acceptance.
    intents.delete(activeId); drafts.delete(activeId); $('prompt').value = ''; sending = false;
  }
  if (recoveryNotice?.id === value.id && recoveryNotice.requestId === value.requestId && value.state !== 'pending') {
    recoveryNotice = undefined; notice('');
  }
  const item = conversationItems.find(item => item.id === value.id);
  if (item) { item.title = value.title; item.state = value.state; renderList(); }
  render();
}
function cancelReader() {
  if (!connection) return;
  connection.stream.cancel(); connection.resolveReady(false); clearTimeout(connection.retryTimer); connection = undefined;
}
function connect(id, expectedView, attempt = 0) {
  cancelReader();
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });
  const owned = { resolveReady, state: 'connecting' }; connection = owned;
  const isCurrent = () => connection === owned && view === expectedView && activeId === id;
  status(attempt ? '恢复连接' : '连接中', 'busy');
  owned.stream = createConversationStream(frame => {
    if (!isCurrent()) return true;
    if (frame.event === 'stream-error') throw Error('stream_unavailable');
    const value = JSON.parse(frame.data).conversation;
    apply(value, expectedView);
    owned.state = 'online'; status('已连接', 'online');
    if (frame.event === 'ready') { if (attempt && !recoveryNotice) notice(''); resolveReady(true); return false; }
    if (terminal(value.state)) { status('已同步', 'online'); return true; }
    return false;
  });
  void owned.stream.read(signal => fetch(`${base}/conversations/${encodeURIComponent(id)}/events`, { credentials: 'same-origin', signal }))
    .catch(() => {
      if (!isCurrent()) return;
      owned.state = 'offline'; status('连接中断', 'busy'); render();
      if (attempt < 2 && busy(current?.state)) {
        notice('连接暂时中断，正在恢复已有回复；不会重发消息。');
        owned.retryTimer = setTimeout(() => { if (isCurrent()) void connect(id, expectedView, attempt + 1); }, 250 * (attempt + 1));
      } else notice('连接已断开，内容已保留。点击“恢复状态”继续读取，不会重发消息。');
    }).finally(() => resolveReady(false));
  return readyPromise;
}

async function selectConversation(id) {
  if (activeId) drafts.set(activeId, $('prompt').value);
  cancelReader(); const expectedView = ++view; activeId = id; current = undefined; sending = false;
  $('prompt').value = drafts.get(id) || ''; notice(''); renderList(); render(); status('读取历史', 'busy');
  document.body.classList.remove('sidebar-open'); history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  try {
    const result = await json(`/conversations/${encodeURIComponent(id)}`);
    if (view !== expectedView) return;
    apply(result.conversation, expectedView); status('已同步', 'online');
    if (busy(current.state) || intents.has(id)) void connect(id, expectedView);
  } catch (error) { if (view === expectedView) { notice(errorText[error.code] || errorText.service_unavailable); status('暂不可用'); } }
}
async function newConversation({ preserveInput = false } = {}) {
  if (!ready) return;
  if (creation?.promise) return creation.promise;
  const command = creation || { requestId: crypto.randomUUID(), draft: preserveInput ? $('prompt').value : '' };
  creation = command;
  if (activeId) drafts.set(activeId, $('prompt').value);
  cancelReader(); const expectedView = ++view; activeId = undefined; current = undefined;
  $('prompt').value = command.draft; notice(''); render(); $('new-chat').disabled = true;
  command.promise = (async () => {
    let accepted = false;
    try {
      const result = await post('/conversations', {}, command.requestId);
      accepted = true;
      command.conversationId = result.conversation.id;
      drafts.set(result.conversation.id, command.draft);
      await refreshList();
      if (view !== expectedView) return;
      await selectConversation(result.conversation.id);
      if (activeId === result.conversation.id && current?.id === activeId) return activeId;
    } catch (error) {
      if (!error.status || error.status >= 500 || error.code === 'dispatch_unknown') {
        command.outcome = 'unknown';
        if (view === expectedView) notice('新建对话的结果暂时未知，输入已保留。点击“恢复状态”继续同一次新建。');
      } else {
        if (creation === command) creation = undefined;
        if (view === expectedView) notice(errorText[error.code] || errorText.service_unavailable);
      }
    } finally {
      command.promise = undefined;
      if (accepted && creation === command) creation = undefined;
      $('new-chat').disabled = !ready; if (view === expectedView) render();
    }
  })();
  return command.promise;
}
async function send(event) {
  event?.preventDefault();
  const text = $('prompt').value.trim();
  if (firstSend && (!activeId || activeId === firstSend.command?.conversationId)) return;
  if (!text || !ready || sending || busy(current?.state) || intents.has(activeId) || !activeId && creation?.outcome === 'unknown') return;
  if (!activeId) {
    if (firstSend) return;
    const pending = {}; firstSend = pending; sending = true; render();
    const creating = newConversation({ preserveInput: true }); pending.command = creation;
    const createdId = await creating;
    if (firstSend === pending) firstSend = undefined;
    if (!createdId || activeId !== createdId) { if (!activeId) { sending = false; render(); } return; }
    $('prompt').value = text;
  }
  const id = activeId, expectedView = view, intent = { requestId: crypto.randomUUID(), text, outcome: 'sending' };
  intents.set(id, intent); drafts.set(id, text); sending = true; notice(''); render();
  const connected = await connect(id, expectedView);
  if (!connected || view !== expectedView || activeId !== id) {
    // No POST was attempted; this intent can safely be discarded.
    if (intents.get(id) === intent) intents.delete(id);
    if (view === expectedView) { sending = false; render(); }
    return;
  }
  try {
    const result = await post(`/conversations/${encodeURIComponent(id)}/messages`, { text }, intent.requestId,
      mode === 'local-demo' ? { 'x-demo-scenario': $('scenario').value } : {});
    if (view === expectedView) { apply(result.conversation, expectedView); notice(''); }
  } catch (error) {
    if (error.code === 'dispatch_unknown' || !error.status || error.status >= 500) {
      if (intents.get(id) === intent) intent.outcome = 'unknown';
      if (view === expectedView && !(current?.requestId === intent.requestId && current.state !== 'pending')) {
        recoveryNotice = { id, requestId: intent.requestId }; notice(errorText.dispatch_unknown);
      }
    } else {
      if (intents.get(id) === intent) intents.delete(id);
      if (view === expectedView) { cancelReader(); notice(errorText[error.code] || errorText.service_unavailable); }
    }
  } finally { if (view === expectedView) { sending = false; render(); } }
}
async function recover() {
  if (!activeId) { if (creation?.outcome === 'unknown') await newConversation({ preserveInput: true }); return; }
  const id = activeId, expectedView = view;
  try {
    const result = await json(`/conversations/${encodeURIComponent(id)}`);
    if (view !== expectedView) return;
    apply(result.conversation, expectedView);
    notice(intents.has(id) ? errorText.dispatch_unknown : '已恢复已有会话，没有重新发送消息。');
    if (busy(current.state) || intents.has(id)) void connect(id, expectedView);
    else { cancelReader(); status('已同步', 'online'); render(); }
  } catch (error) { if (view === expectedView) notice(errorText[error.code] || errorText.service_unavailable); }
}
$('stop').onclick = async () => {
  const id = activeId, expectedView = view, runId = current?.runId;
  if (!id || !runId) return;
  $('stop').disabled = true;
  try {
    const result = await post(`/conversations/${encodeURIComponent(id)}/interrupt`, { runId }, crypto.randomUUID());
    if (view === expectedView) { apply(result.conversation, expectedView); cancelReader(); notice(''); status('已停止', 'online'); }
  } catch (error) { if (view === expectedView) notice(errorText[error.code] || errorText.service_unavailable); }
  finally { $('stop').disabled = false; }
};
$('composer').onsubmit = send; $('new-chat').onclick = () => newConversation(); $('recover').onclick = recover;
$('prompt').oninput = render;
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } };
for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); render(); };
$('menu').onclick = () => document.body.classList.add('sidebar-open'); $('sidebar-scrim').onclick = () => document.body.classList.remove('sidebar-open');
const setTheme = theme => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('chat-example-theme', theme); } catch {} };
try { setTheme(localStorage.getItem('chat-example-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch {}
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
addEventListener('pagehide', cancelReader);
async function start() {
  render(); $('new-chat').disabled = true;
  try {
    const config = await json('/config'); mode = config.mode; ready = true;
    $('mode-badge').textContent = mode === 'local-demo' ? '本地示例 · 不调用 AI' : '已连接对话服务';
    $('mode-description').textContent = mode === 'local-demo' ? '回复为本地演示内容。刷新可重开历史，停止本地服务后清空。' : '消息由已配置的服务端会话服务处理。';
    $('persistence-note').textContent = mode === 'local-demo' ? '历史保留至本地服务停止' : '通过服务端读取会话历史';
    $('exercise').hidden = mode !== 'local-demo'; $('new-chat').disabled = false;
    await refreshList();
    const requested = decodeURIComponent(location.hash.slice(1));
    if (conversationItems.some(item => item.id === requested)) await selectConversation(requested);
    else { status('准备就绪', 'online'); render(); }
  } catch (error) { ready = false; $('mode-badge').textContent = '服务未就绪'; notice(errorText[error.code] || errorText.service_unavailable); status('暂不可用'); render(); }
}
void start();
