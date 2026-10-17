import { configureAuthForms } from './auth-forms.mjs';
const base = '/functions/v1/app';
const alert = document.querySelector('[role="alert"]');
let pending;
async function json(path, init = {}) {
  const response = await fetch(base + path, { credentials: 'same-origin', cache: 'no-store', ...init });
  if (!response.ok) throw Object.assign(new Error('request_failed'), { status: response.status });
  return response.json();
}
async function load() {
  const session = await json('/auth/session');
  const user = session?.user?.id;
  document.querySelector('#session').textContent = user ? `已登录：${user}` : '未登录';
  document.querySelector('#signout').hidden = !user;
  document.querySelector('#notes').hidden = !user;
  const list = document.querySelector('#list'); list.replaceChildren();
  if (user) for (const note of await json('/api/notes')) {
    const item = document.createElement('li'); item.textContent = note.title; list.append(item);
  }
}
const report = () => { alert.textContent = '请求未完成。请检查登录和站点配置；写入不会自动重试。'; };
const form = document.querySelector('#note-form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const input = form.elements.namedItem('title'), button = form.querySelector('button');
  if (button.disabled) return;
  pending ??= { id: crypto.randomUUID(), title: input.value };
  button.disabled = true; input.disabled = true;
  try {
    await json('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': pending.id }, body: JSON.stringify({ title: pending.title }) });
    pending = undefined; form.reset(); input.disabled = false; button.textContent = '保存'; alert.textContent = ''; await load().catch(report);
  } catch (error) {
    if (!pending.uncertain && error.status >= 400 && error.status < 500 && error.status !== 408) {
      pending = undefined; input.disabled = false; button.textContent = '保存';
      alert.textContent = '请求被拒绝。请检查输入和登录状态后重新提交。';
    } else {
      // A later rejection cannot prove an earlier disconnected attempt failed.
      pending.uncertain = true;
      report(); button.textContent = '重试原请求';
    }
  }
  finally { button.disabled = false; }
});
document.querySelector('#reload').addEventListener('click', () => load().catch(report));
await configureAuthForms(document);
await load().catch(report);
