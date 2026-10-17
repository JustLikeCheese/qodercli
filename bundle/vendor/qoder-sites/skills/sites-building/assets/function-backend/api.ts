export type Note = { id: string; title: string; version: number; created_at?: string };
export type Attachment = { id: string; status: string; created_at?: string };
export class RequestError extends Error {
  constructor(public code: string, public status = 0, public uncertain = false) { super(code); }
}
export async function requestBackend(path: string, init?: RequestInit): Promise<any> {
  let response: Response;
  try { response = await fetch(`/functions/v1/app${path}`, { ...init, credentials: 'same-origin', signal: init?.signal ?? AbortSignal.timeout(20_000) }); }
  catch { throw new RequestError('network_error', 0, true); }
  let body: any;
  try { body = await response.json(); } catch { throw new RequestError('invalid_response', response.status, true); }
  if (!response.ok) throw new RequestError(typeof body?.error === 'string' ? body.error : 'request_failed', response.status, response.status >= 500 || response.status === 408);
  return body;
}
export function noteResult(value: unknown): Note {
  const row = value as Note;
  if (!row || typeof row.id !== 'string' || typeof row.title !== 'string' || !Number.isInteger(row.version)) throw new RequestError('invalid_response', 0, true);
  return row;
}
export function noteList(value: unknown): Note[] {
  if (!Array.isArray(value)) throw new RequestError('invalid_response');
  return value.map(noteResult);
}
export function attachmentList(value: unknown): Attachment[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row.id !== 'string' || !['pending', 'ready'].includes(row.status))) throw new RequestError('invalid_response');
  return value;
}
export function signedPath(value: unknown): string {
  const path = (value as { signedUrl?: unknown })?.signedUrl;
  if (typeof path !== 'string' || !path.startsWith('/storage/v1/') || /[\\\r\n]/.test(path)) throw new RequestError('invalid_response', 0, true);
  return path;
}
export function message(error: unknown): string {
  const code = error instanceof RequestError ? error.code : '';
  return ({
    login_required: '请先登录站点，再重新读取。', account_changed: '当前账号已切换，已清除上一个账号的页面状态，请重新读取。',
    not_found: '这条记录已不存在，或当前账号无权访问。', invalid_input: '请检查输入内容后重试。',
    write_conflict: '这条记录有更新。请读取最新内容，核对后再保存。', idempotency_conflict: '恢复命令与原始内容不一致，请核对已有记录。',
    upload_pending: '文件尚未确认。可重新核对上传结果；不要重新创建附件。', invalid_upload: '仅支持不超过 5 MB 的 PNG、JPEG 或 PDF 文件。',
    database_not_configured: '数据服务尚未配置完成。', database_credential_rejected: '数据服务暂不可用，请联系站点管理员。',
    network_error: '连接中断，尚无法确认本次操作的结果。', invalid_response: '服务返回了无法识别的结果，请重新读取。',
  } as Record<string, string>)[code] ?? '暂时无法完成操作，请稍后重试。';
}
