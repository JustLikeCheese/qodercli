// 同源 Function 请求助手（由模板 assets/database-react/api.ts 转为 JavaScript）。
export class ApiError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// messages 是本站自有的本地化文案，按已知的公开错误码索引。
// 永远不要直接渲染服务端或网关返回的任意文本。
export async function requestJson(url, init = {}, messages = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  let response;
  try {
    response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError('请求未能完成。重试写入前请先确认当前状态。', 'network_error');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(response.status === 401 ? '请先登录后继续。' : '你没有执行该操作的权限。', 'access_denied', response.status);
  }
  if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError('站点服务返回了非预期的响应，请检查访问权限。', 'invalid_response', response.status);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new ApiError('站点服务返回了无效的 JSON。', 'invalid_response', response.status); }
  const body = data && typeof data === 'object' ? data : null;
  const code = typeof body?.error === 'string' ? body.error
    : (!response.ok || body?.ok === false) && typeof body?.code === 'string' ? body.code
    : response.ok ? null : 'request_failed';
  if (!response.ok || body?.ok === false || code) {
    const resolved = code ?? 'request_failed';
    const message = Object.prototype.hasOwnProperty.call(messages, resolved)
      ? messages[resolved]
      : '请求失败。重试写入前请先确认当前状态。';
    throw new ApiError(message, resolved, response.status);
  }
  return data;
}

// 响应丢失无法证明写入是否提交；不要在这里自动重放。
export function isWriteOutcomeUnknown(error) {
  if (!(error instanceof ApiError) || error.status === 401 || error.status === 403) return false;
  // 函数也用 HTTP 503 表示明确的业务拒绝，这类结果不是「未知」。
  // 未配置同样是一个明确的拒绝：服务端没有接受这次写入。
  if (error.code === 'write_rejected' || error.code === 'application_auth_not_configured') return false;
  return ['network_error', 'invalid_response', 'write_result_unknown'].includes(error.code)
    || (error.status >= 500 && error.status < 600);
}
