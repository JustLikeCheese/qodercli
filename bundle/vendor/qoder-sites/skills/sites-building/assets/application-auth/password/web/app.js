// 账号认证实验室前端：注册 / 登录 / 退出 / 当前账号 / 自有记录。
// 口令只在提交那一刻从输入框读取并使用，随后立即清空；不写入任何存储、不留在状态里。
// 不使用 localStorage / sessionStorage；会话只存在于服务端 + HttpOnly Cookie。
import { ApiError, requestJson, isWriteOutcomeUnknown } from './api.js';

const PATH = '/functions/v1/app';
const ME_ENDPOINT = `${PATH}/api/me`;
const NOTES_ENDPOINT = `${PATH}/api/notes`;
const REGISTER_ENDPOINT = `${PATH}/api/register`;
const LOGIN_ENDPOINT = `${PATH}/api/login`;
const LOGOUT_ENDPOINT = `${PATH}/api/logout`;

const MESSAGES = {
  invalid_username: '用户名需为 3–32 位，可含小写字母、数字、下划线或短横线，并以字母或数字开头。',
  invalid_password: '密码至少 15 个字符，且不超过 256 字节（UTF-8）。',
  invalid_input: '请求格式不正确，请检查输入后重试。',
  username_taken: '该用户名已被注册，请换一个。',
  invalid_credentials: '用户名或密码不正确。',
  rate_limited: '尝试次数过于频繁，请稍后再试。',
  login_required: '请先登录。',
  origin_forbidden: '请求来源校验未通过，已被拒绝。',
  registration_unconfirmed: '注册结果未确认。可稍后用同一用户名重试：若账号已创建，会提示用户名已被注册。',
  logout_unconfirmed: '退出结果未确认，会话可能仍然有效。请重试退出。',
  note_unconfirmed: '记录写入结果未确认。请重新读取确认后再提交。',
  idempotency_conflict: '该幂等键已用于另一条命令，请重新创建。',
  database_unavailable: '数据服务暂时不可用，请稍后重试。',
  payload_too_large: '请求内容过大，已被拒绝。',
  method_not_allowed: '请求方法不被允许。',
  not_found: '请求的接口不存在。',
  service_unavailable: '服务暂时不可用，请稍后重试。',
};

const el = {
  chip: document.getElementById('auth-chip'),
  guestCard: document.getElementById('guest-card'),
  registerCard: document.getElementById('register-card'),
  accountCard: document.getElementById('account-card'),
  accountBody: document.getElementById('account-body'),
  accountStatus: document.getElementById('account-status'),
  notesCard: document.getElementById('notes-card'),
  error: document.getElementById('error'),
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginSubmit: document.getElementById('login-submit'),
  loginToggle: document.getElementById('login-toggle'),
  registerForm: document.getElementById('register-form'),
  registerUsername: document.getElementById('register-username'),
  registerPassword: document.getElementById('register-password'),
  registerSubmit: document.getElementById('register-submit'),
  registerToggle: document.getElementById('register-toggle'),
  logout: document.getElementById('logout'),
  reload: document.getElementById('reload'),
  noteForm: document.getElementById('note-form'),
  noteTitle: document.getElementById('note-title'),
  createNote: document.getElementById('create-note'),
  noteStatus: document.getElementById('note-status'),
  noteError: document.getElementById('note-error'),
  notes: document.getElementById('notes'),
  notesEmpty: document.getElementById('notes-empty'),
};

const state = {
  user: null,
  notes: [],
  pending: null,      // 未确认的创建命令 {userId, key, title}
  busy: false,
  expired: false,     // 之前登录过、但当前会话已失效
};

function setError(message) {
  el.error.textContent = message;
  el.error.hidden = !message;
}

function render() {
  const authorized = Boolean(state.user);

  el.chip.textContent = authorized ? '已登录' : state.busy ? '处理中…' : state.expired ? '登录状态已失效' : '未登录';
  el.chip.className = `chip ${authorized ? 'chip-ok' : state.expired ? 'chip-warn' : 'chip-idle'}`;

  el.guestCard.hidden = authorized;
  el.registerCard.hidden = authorized;
  el.accountCard.hidden = !authorized;
  el.notesCard.hidden = !authorized;

  el.loginUsername.disabled = state.busy;
  el.loginPassword.disabled = state.busy;
  el.loginSubmit.disabled = state.busy || !el.loginUsername.value.trim() || !el.loginPassword.value;
  el.registerUsername.disabled = state.busy;
  el.registerPassword.disabled = state.busy;
  el.registerSubmit.disabled = state.busy || !el.registerUsername.value.trim() || !el.registerPassword.value;

  if (authorized) {
    el.accountBody.innerHTML = '';
    const box = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'muted';
    label.textContent = '本站账号';
    const who = document.createElement('p');
    who.className = 'who';
    who.textContent = state.user.username;
    const id = document.createElement('code');
    id.className = 'uid';
    id.textContent = state.user.id;
    box.append(label, who, id);
    el.accountBody.append(box);
  }

  el.noteTitle.disabled = state.busy || Boolean(state.pending);
  el.createNote.disabled = state.busy || !el.noteTitle.value.trim();
  el.createNote.textContent = state.pending ? '重试创建（同一幂等键）' : '创建记录';

  el.notes.innerHTML = '';
  for (const note of state.notes) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = note.title;
    const meta = document.createElement('code');
    meta.className = 'meta';
    meta.textContent = note.id.slice(0, 8);
    li.append(title, meta);
    el.notes.append(li);
  }
  el.notesEmpty.hidden = !authorized || state.notes.length > 0;
}

async function withBusy(action) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await action();
  } finally {
    state.busy = false;
    render();
  }
}

function handleFailure(cause) {
  return cause instanceof Error ? cause.message : '服务暂时不可用，请稍后重试。';
}

async function loadNotes() {
  const rows = await requestJson(NOTES_ENDPOINT, {}, MESSAGES);
  if (!Array.isArray(rows) || rows.some((row) => typeof row?.id !== 'string' || typeof row?.title !== 'string')) {
    throw new ApiError('响应结构无效', 'invalid_response');
  }
  state.notes = rows;
}

function acceptUser(user) {
  // 重新认证只恢复同一用户的命令，不能把旧账号的写入带到新账号。
  if (state.pending && state.pending.userId !== user.id) {
    state.pending = null;
    el.noteTitle.value = '';
    el.noteStatus.textContent = '';
  }
  state.user = user;
  state.expired = false;
}

async function loadSession() {
  try {
    const body = await requestJson(ME_ENDPOINT, {}, MESSAGES);
    if (!body?.user || typeof body.user.id !== 'string' || typeof body.user.username !== 'string') {
      throw new ApiError('响应结构无效', 'invalid_response');
    }
    acceptUser(body.user);
    setError('');
    await loadNotes();
    el.accountStatus.textContent = '已读取当前账号与记录。';
  } catch (cause) {
    const wasLoggedIn = Boolean(state.user);
    state.user = null;
    state.notes = [];
    if (cause instanceof ApiError && cause.status === 401) {
      state.expired = wasLoggedIn;
      setError(wasLoggedIn ? '登录状态已失效，请重新登录。' : '');
    } else {
      setError(handleFailure(cause));
    }
  } finally {
    render();
  }
}

async function submitCredentials(endpoint, usernameInput, passwordInput) {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;   // 只在此处读取一次
  passwordInput.value = '';               // 立即从输入框移除，不进入任何状态
  setError('');
  await withBusy(async () => {
    try {
      const body = await requestJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }, MESSAGES);
      if (!body?.user || typeof body.user.id !== 'string' || typeof body.user.username !== 'string') {
        throw new ApiError('响应结构无效', 'invalid_response');
      }
      usernameInput.value = '';
      acceptUser(body.user);
      el.noteTitle.value = state.pending?.title ?? '';
      el.noteStatus.textContent = '';
      try {
        await loadNotes();
      } catch (readError) {
        // 登录已成功；列表读取失败只提示读取问题，不重复任何写入。
        setError(handleFailure(readError));
      }
      el.accountStatus.textContent = '登录成功。';
    } catch (cause) {
      setError(handleFailure(cause));
    }
  });
}

async function logout() {
  el.accountStatus.textContent = '';
  setError('');
  await withBusy(async () => {
    try {
      await requestJson(LOGOUT_ENDPOINT, { method: 'POST' }, MESSAGES);
    } catch (cause) {
      // 撤销未确认时不谎报成功：保留当前界面，允许在会话仍有效时重试。
      setError(handleFailure(cause));
      return;
    }
    state.user = null;
    state.notes = [];
    state.pending = null;
    state.expired = false;
    el.loginUsername.value = '';
    el.loginPassword.value = '';
    el.registerUsername.value = '';
    el.registerPassword.value = '';
    el.noteTitle.value = '';
    el.accountStatus.textContent = '';
    el.noteStatus.textContent = '';
  });
}

async function createNote() {
  if (!state.user || state.busy) return;
  // 结果未知时保留完全相同的命令与幂等键；恢复前禁止修改标题。
  state.pending ??= { userId: state.user.id, key: crypto.randomUUID(), title: el.noteTitle.value };
  const command = state.pending;
  await withBusy(async () => {
    el.noteStatus.textContent = '';
    setError('');
    try {
      const created = await requestJson(NOTES_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': command.key },
        body: JSON.stringify({ title: command.title }),
      }, MESSAGES);
      if (typeof created?.id !== 'string' || typeof created?.title !== 'string') {
        throw new ApiError('响应结构无效', 'invalid_response');
      }
      state.pending = null;
      el.noteTitle.value = '';
      await loadNotes();
      el.noteStatus.textContent = '记录已创建。';
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'idempotency_conflict') {
        state.pending = null;
        setError(handleFailure(cause));
        return;
      }
      if (isWriteOutcomeUnknown(cause)) {
        setError('创建结果未确认。可保持标题不变并重试「重试创建」，或重新读取后再提交。');
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        state.user = null;
        state.notes = [];
        // 本次未认证不能证明此前结果未知的同一命令没有提交。
        state.expired = true;
      }
      setError(handleFailure(cause));
    }
  });
}

function bindToggle(button, input) {
  button.addEventListener('click', () => {
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    button.textContent = shown ? '显示密码' : '隐藏密码';
    button.setAttribute('aria-pressed', String(!shown));
  });
}

bindToggle(el.loginToggle, el.loginPassword);
bindToggle(el.registerToggle, el.registerPassword);

el.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitCredentials(LOGIN_ENDPOINT, el.loginUsername, el.loginPassword);
});
el.registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitCredentials(REGISTER_ENDPOINT, el.registerUsername, el.registerPassword);
});
for (const input of [el.loginUsername, el.loginPassword, el.registerUsername, el.registerPassword]) {
  input.addEventListener('input', render);
}
el.logout.addEventListener('click', () => void logout());
el.reload.addEventListener('click', () => withBusy(loadSession));
el.noteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void createNote();
});
el.noteTitle.addEventListener('input', render);

render();
void loadSession();
