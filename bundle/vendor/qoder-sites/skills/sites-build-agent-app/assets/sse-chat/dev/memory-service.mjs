// DEV ONLY: process-local fixtures, not a durable coordinator or Cloud Agents.
import { ChatError } from '../handler.mjs';

const done = state => ['completed', 'failed', 'interrupted'].includes(state);
export function createMemoryService({ intervalMs = 35, authorize = async () => ({ id: 'local-visitor' }) } = {}) {
  const conversations = new Map(), creations = new Map();
  let closed = false;
  const copy = item => structuredClone({ id: item.id, title: item.title, revision: item.revision, state: item.state, messages: item.messages, runId: item.runId, requestId: item.requestId });
  const owned = (user, id) => {
    const item = conversations.get(id);
    if (!item || item.owner !== user.id) throw new ChatError('not_found');
    return item;
  };
  const update = item => { item.revision++; for (const notify of item.listeners) notify(); };
  function generate(item, mode) {
    const answer = `这是本地受控回复，没有调用任何 AI 服务。\n\n你刚才说：“${item.messages.at(-2).text}”\n\n这个示例已经串起输入、Function 路由和真正的 SSE 流。你可以切换会话再回来，或者点“停止回复”，观察状态如何保留。\n\n接入真实 QCA 时，保留这套界面与路由，在服务端实现授权、会话绑定、持久化和消息恢复。`;
    const chunks = answer.match(/.{1,4}|\n/g) || [];
    let offset = 0;
    const tick = () => {
      if (done(item.state)) return;
      item.state = 'running'; item.messages.at(-1).state = 'running';
      if (mode === 'failure' && offset > 12) {
        item.state = 'failed'; item.messages.at(-1).state = 'failed'; update(item); return;
      }
      item.messages.at(-1).text += chunks[offset++] || '';
      if (offset >= chunks.length) { item.state = 'completed'; item.messages.at(-1).state = 'completed'; }
      update(item);
      if (!done(item.state)) item.timer = setTimeout(tick, intervalMs);
    };
    item.timer = setTimeout(tick, mode === 'unknown' ? intervalMs * 12 : intervalMs);
  }
  return {
    authorize,
    info: () => ({ mode: 'local-demo', persistence: 'memory-until-server-exit' }),
    async list(user) { return [...conversations.values()].filter(item => item.owner === user.id).reverse().map(copy); },
    async create(user, { requestId }) {
      const key = `${user.id}:${requestId}`;
      if (creations.has(key)) return copy(owned(user, creations.get(key)));
      if ([...conversations.values()].filter(item => item.owner === user.id).length >= 30) throw new ChatError('conversation_busy');
      const item = { id: `chat_${crypto.randomUUID()}`, owner: user.id, title: '新的对话', revision: 0, state: 'idle', messages: [], requests: new Map(), listeners: new Set() };
      conversations.set(item.id, item); creations.set(key, item.id);
      return copy(item);
    },
    async get(user, id) { return copy(owned(user, id)); },
    async send(user, id, { requestId, text }, request) {
      const item = owned(user, id), previous = item.requests.get(requestId);
      if (previous) {
        if (previous !== text) throw new ChatError('request_conflict');
        return copy(item);
      }
      if (['running', 'pending'].includes(item.state) || item.messages.length >= 98) throw new ChatError('conversation_busy');
      const mode = request?.headers.get('x-demo-scenario') || 'normal';
      if (!['normal', 'failure', 'unknown', 'disconnect'].includes(mode)) throw new ChatError('invalid_request');
      item.requests.set(requestId, text);
      item.title = text.slice(0, 32); item.runId = `run_${crypto.randomUUID()}`; item.requestId = requestId;
      item.state = mode === 'unknown' ? 'pending' : 'running';
      item.disconnect = mode === 'disconnect';
      item.messages.push({ id: `msg_${crypto.randomUUID()}`, role: 'user', text, state: 'completed' },
        { id: `msg_${crypto.randomUUID()}`, role: 'assistant', text: '', state: item.state });
      update(item); generate(item, mode);
      if (mode === 'unknown') throw new ChatError('dispatch_unknown');
      return copy(item);
    },
    async interrupt(user, id, { runId }) {
      const item = owned(user, id);
      if (item.runId !== runId) throw new ChatError('request_conflict');
      if (!done(item.state)) {
        clearTimeout(item.timer); item.state = 'interrupted'; item.messages.at(-1).state = 'interrupted'; update(item);
      }
      return copy(item);
    },
    async *watch(user, id, { signal }) {
      const item = owned(user, id);
      let dirty = true, wake;
      const notify = () => { dirty = true; wake?.(); };
      item.listeners.add(notify); signal.addEventListener('abort', notify, { once: true });
      try {
        while (!signal.aborted && !closed) {
          if (!dirty) await new Promise(resolve => { wake = resolve; });
          wake = undefined;
          if (signal.aborted || closed) return;
          dirty = false;
          if (item.disconnect && item.messages.at(-1)?.text.length > 20) {
            item.disconnect = false;
            throw Error('controlled read interruption');
          }
          yield copy(item);
        }
      } finally { item.listeners.delete(notify); signal.removeEventListener('abort', notify); }
    },
    close() { closed = true; for (const item of conversations.values()) { clearTimeout(item.timer); for (const notify of item.listeners) notify(); } },
  };
}
