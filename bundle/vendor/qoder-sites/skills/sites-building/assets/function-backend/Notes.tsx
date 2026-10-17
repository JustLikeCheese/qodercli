// Copy with api.ts and records.css into the frontend, never the Function ZIP.
import { useEffect, useRef, useState } from 'react';
import { attachmentList, message, noteList, noteResult, RequestError, requestBackend, signedPath, type Attachment, type Note } from './api';
import './records.css';
export { requestBackend } from './api';
type PendingCreate = { key: string; title: string; owner: string; uncertain: boolean };
type Upload = { id: string; noteId: string; owner: string; name: string; phase: 'uploading' | 'confirm' };
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)) : '刚刚';
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function Notes({ local = false }: { local?: boolean }) {
  const [notes, setNotes] = useState<Note[]>([]), [query, setQuery] = useState('');
  const [owner, setOwner] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<Note | null>(null), [editTitle, setEditTitle] = useState('');
  const [title, setTitle] = useState(''), [creating, setCreating] = useState(false), [pending, setPending] = useState<PendingCreate | null>(null);
  const [saving, setSaving] = useState(false), [editBlocked, setEditBlocked] = useState(false), [editError, setEditError] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]), [filesLoading, setFilesLoading] = useState(false), [filesError, setFilesError] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null), [progress, setProgress] = useState(0), [fileBusy, setFileBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const listEpoch = useRef(0), fileEpoch = useRef(0), ownerRef = useRef(''), selectedRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingCreate | null>(null), mounted = useRef(true);
  const createLock = useRef(false), saveLock = useRef(false), fileLock = useRef(false);
  const detail = useRef<HTMLElement | null>(null);
  function remember(command: PendingCreate | null) { pendingRef.current = command; setPending(command); }
  function clearAccount() {
    fileEpoch.current++; selectedRef.current = null; setSelected(null); setNotes([]); setAttachments([]);
    remember(null); setTitle(''); setEditTitle(''); setUpload(null); setEditBlocked(false); setEditError(''); setFilesError('');
  }
  function hidePrivateData() {
    fileEpoch.current++; selectedRef.current = null; setOwner(''); setSelected(null); setNotes([]); setAttachments([]); setUpload(null);
    setEditTitle(''); setEditError(''); setFilesError(''); setFilesLoading(false);
    // Keep an unresolved create bound to its original owner until identity is known again.
  }
  async function identity() {
    let value;
    try { value = await requestBackend('/api/me'); }
    catch (e) { if (e instanceof RequestError && e.code === 'login_required') hidePrivateData(); throw e; }
    if (typeof value?.id !== 'string' || !value.id) throw new RequestError('invalid_response');
    return value.id as string;
  }
  async function checkOwner(expected: string) {
    const actual = await identity();
    if (actual !== expected) { clearAccount(); ownerRef.current = actual; setOwner(actual); throw new RequestError('account_changed', 409); }
  }
  async function refresh() {
    const epoch = ++listEpoch.current;
    setLoading(true); setError('');
    try {
      const current = await identity();
      if (!mounted.current || epoch !== listEpoch.current) return;
      if (ownerRef.current && ownerRef.current !== current) clearAccount();
      ownerRef.current = current; setOwner(current);
      const rows = noteList(await requestBackend('/api/notes'));
      if (mounted.current && epoch === listEpoch.current && ownerRef.current === current) setNotes(rows);
    } catch (e) { if (mounted.current && epoch === listEpoch.current) { if (e instanceof RequestError && e.code === 'login_required') hidePrivateData(); setError(message(e)); } }
    finally { if (mounted.current && epoch === listEpoch.current) setLoading(false); }
  }
  async function loadFiles(noteId: string, expectedOwner = ownerRef.current) {
    const epoch = ++fileEpoch.current; setFilesLoading(true); setFilesError('');
    try {
      const rows = attachmentList(await requestBackend(`/api/notes/${noteId}/uploads`));
      if (mounted.current && epoch === fileEpoch.current && selectedRef.current === noteId && ownerRef.current === expectedOwner) setAttachments(rows);
    } catch (e) { if (mounted.current && epoch === fileEpoch.current && selectedRef.current === noteId) { if (e instanceof RequestError && e.code === 'login_required') hidePrivateData(); else setFilesError(message(e)); } }
    finally { if (mounted.current && epoch === fileEpoch.current) setFilesLoading(false); }
  }
  function select(note: Note) {
    if (saving || fileBusy) return;
    selectedRef.current = note.id; setSelected(note); setEditTitle(note.title); setEditError(''); setEditBlocked(false); setAttachments([]);
    void loadFiles(note.id);
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; listEpoch.current++; fileEpoch.current++; };
  }, []);
  useEffect(() => {
    if (selected && window.matchMedia?.('(max-width: 1040px)').matches) {
      detail.current?.focus({ preventScroll: true }); detail.current?.scrollIntoView({ block: 'start' });
    }
  }, [selected?.id]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (pendingRef.current || upload) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [upload]);
  async function create() {
    if (createLock.current || saveLock.current || fileLock.current || !owner || (!pendingRef.current && !title.trim())) return;
    createLock.current = true; setCreating(true); setError(''); setNotice('');
    const command = pendingRef.current ?? { key: crypto.randomUUID(), title: title.trim(), owner, uncertain: false }; remember(command);
    try {
      await checkOwner(command.owner);
      const created = noteResult(await requestBackend('/api/notes', { ...json('POST', { title: command.title }), headers: { 'content-type': 'application/json', 'idempotency-key': command.key } }));
      if (ownerRef.current !== command.owner) return;
      remember(null); setTitle(''); setNotice('记录已保存。');
      setNotes(current => [created, ...current.filter(row => row.id !== created.id)].slice(0, 100)); select(created);
      void refresh(); // A failed follow-up read never replays the confirmed write.
    } catch (e) {
      if (e instanceof RequestError && e.code === 'account_changed') remember(null);
      else if (command.uncertain || !(e instanceof RequestError) || e.uncertain) remember({ ...command, uncertain: true });
      else remember(null);
      setError(message(e));
    } finally { createLock.current = false; setCreating(false); }
  }
  async function save() {
    if (!selected || saveLock.current || createLock.current || fileLock.current || editBlocked || !editTitle.trim()) return;
    saveLock.current = true; setSaving(true); setEditError(''); setNotice('');
    const current = selected, expectedOwner = owner;
    try {
      await checkOwner(expectedOwner);
      const updated = noteResult(await requestBackend(`/api/notes/${current.id}`, json('PATCH', { title: editTitle.trim(), version: current.version })));
      if (ownerRef.current !== expectedOwner) return;
      const complete = { ...current, ...updated }; setSelected(complete); setEditTitle(updated.title); setNotes(rows => rows.map(row => row.id === updated.id ? complete : row)); setNotice('修改已保存。');
    } catch (e) { setEditError(message(e)); setEditBlocked(!(e instanceof RequestError) || e.uncertain || e.code === 'write_conflict'); }
    finally { saveLock.current = false; setSaving(false); }
  }
  async function reconcileEdit() {
    if (!selected || saveLock.current) return;
    const id = selected.id, expectedOwner = owner; setSaving(true); saveLock.current = true;
    try {
      await checkOwner(expectedOwner); const current = noteResult(await requestBackend(`/api/notes/${id}`));
      if (ownerRef.current !== expectedOwner || selectedRef.current !== id) return;
      setSelected(current); setNotes(rows => rows.map(row => row.id === id ? current : row)); setEditBlocked(false);
      setEditError(current.title === editTitle.trim() ? '' : `最新保存的标题是「${current.title}」。你的输入已保留，请核对后再保存。`);
      setNotice(current.title === editTitle.trim() ? '已确认当前记录包含你的修改。' : '已读取最新版本。');
    } catch (e) { setEditError(message(e)); }
    finally { saveLock.current = false; setSaving(false); }
  }
  async function confirmUpload(item: Upload) {
    await checkOwner(item.owner); await requestBackend(`/api/attachments/${item.id}/complete`, json('POST', {}));
    if (ownerRef.current !== item.owner) return;
    setUpload(null); setNotice('附件已上传并确认。');
    if (selectedRef.current === item.noteId) await loadFiles(item.noteId, item.owner);
  }
  async function attach(file: File) {
    if (!selected || fileLock.current || upload) return;
    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) { setFilesError(message(new RequestError('invalid_upload'))); return; }
    const noteId = selected.id, expectedOwner = owner; fileLock.current = true; setFileBusy(true); setFilesError(''); setProgress(0); setNotice('');
    let item: Upload | null = null;
    try {
      await checkOwner(expectedOwner);
      const result = await requestBackend(`/api/notes/${noteId}/uploads`, json('POST', {}));
      if (typeof result?.id !== 'string') throw new RequestError('invalid_response', 0, true);
      const url = signedPath(result); item = { id: result.id, noteId, owner: expectedOwner, name: file.name, phase: 'uploading' }; setUpload(item);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('PUT', url); xhr.timeout = 60_000;
        xhr.setRequestHeader('content-type', file.type); xhr.setRequestHeader('x-upsert', 'false');
        xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new RequestError('upload_pending', xhr.status, true));
        xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new RequestError('network_error', 0, true)); xhr.send(file);
      });
      item = { ...item, phase: 'confirm' }; setUpload(item); setProgress(100); await confirmUpload(item);
    } catch (e) {
      if (item && ownerRef.current === expectedOwner) setUpload({ ...item, phase: 'confirm' });
      if (selectedRef.current === noteId && ownerRef.current === expectedOwner) {
        setFilesError(item ? `${message(e)} 请核对同一附件，不会自动重复上传。` : `${message(e)} 请重新读取附件列表，确认是否已生成待确认附件。`);
      }
    } finally { fileLock.current = false; setFileBusy(false); }
  }
  async function confirm(item: Upload) {
    if (fileLock.current) return; fileLock.current = true; setFileBusy(true); setFilesError('');
    try { await confirmUpload(item); } catch (e) { setFilesError(message(e)); }
    finally { fileLock.current = false; setFileBusy(false); }
  }
  async function download(file: Attachment) {
    const expectedOwner = owner;
    try {
      await checkOwner(expectedOwner); const path = signedPath(await requestBackend(`/api/attachments/${file.id}/download`, json('POST', {})));
      if (ownerRef.current !== expectedOwner) return;
      const link = document.createElement('a'); link.href = path; link.download = ''; link.rel = 'noopener'; link.click();
    } catch (e) { setFilesError(message(e)); }
  }
  const visible = notes.filter(note => note.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="records-app">
    <aside className="records-rail" aria-label="工作区"><a className="records-brand" href="#records"><span aria-hidden="true">▤</span> 拾页 <small>FIELDNOTES</small></a><div className="rail-label">个人工作区</div><a href="#records" className="rail-active">全部记录 <span>{notes.length}</span></a><div className="rail-bottom"><span className="workspace-avatar">我</span><div>我的资料空间<small>记录与附件，井然有序</small></div></div></aside>
    <main id="records" className="records-main">
      <header className="records-topbar"><span>工作区 <span aria-hidden="true">/</span> 全部记录</span><span className="privacy-label">仅当前账号可见</span></header>
      {local && <div className="local-notice">本地示例 · 数据仅保存在本次运行内存中，重启后重置。<a href="/__local/" target="_blank" rel="noreferrer">测试控制台 ↗</a></div>}
      <section className="records-heading"><div><p className="records-eyebrow">YOUR EVERYDAY ARCHIVE</p><h1>想法有个好去处。</h1><p>留住正在推进的事，把相关资料放在一起。</p></div><button className="records-button secondary" onClick={() => void refresh()} disabled={loading || creating || saving || fileBusy}>{loading ? '读取中…' : '重新读取'}</button></section>
      <form className="quick-create" onSubmit={event => { event.preventDefault(); void create(); }}><span aria-hidden="true" className="create-mark">＋</span><label className="sr-only" htmlFor="new-record">新记录标题</label><input id="new-record" placeholder="有什么值得记下来？" maxLength={300} value={title} onChange={event => setTitle(event.target.value)} disabled={creating || !!pending} /><button className="records-button" disabled={creating || saving || fileBusy || !owner || (!pending && !title.trim())}>{creating ? '保存中…' : pending ? '核对并恢复创建' : '添加记录'}</button></form>
      {pending?.uncertain && <div className="records-alert warning" role="status">创建结果尚未确认。已保留原始标题与操作标识；恢复不会创建重复记录。请保留此页面，关闭或刷新会丢失本地恢复信息。</div>}
      {upload && upload.noteId !== selected?.id && <div className="records-alert warning" role="status">另一条记录有待核对的附件。<button onClick={() => { const note = notes.find(row => row.id === upload.noteId); if (note) select(note); }}>返回该记录</button></div>}
      {error && <div className="records-alert" role="alert">{error} <button onClick={() => void refresh()} disabled={loading || creating}>重新读取</button></div>}{notice && <p className="records-notice" role="status">{notice}</p>}
      <div className={'records-columns' + (selected ? ' has-selection' : '')}>
        <section className="records-list-panel" aria-label="记录列表"><div className="records-toolbar"><div><h2>全部记录 <span>{visible.length}</span></h2><p>筛选仅作用于已载入的最近 {notes.length} 条，最多 100 条。</p></div><label className="record-search"><span className="sr-only">筛选已载入记录</span><input type="search" placeholder="查找记录…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
          {loading && notes.length === 0 ? <div className="records-empty" role="status"><span className="records-loader" />正在读取你的记录…</div> : visible.length === 0 ? <div className="records-empty"><span className="empty-glyph" aria-hidden="true">▤</span><h3>{query ? '没有匹配的记录' : error ? '暂时无法读取记录' : '从第一条记录开始'}</h3><p>{query ? '试试其他关键词，或清空筛选。' : error ? '已有内容不会因读取失败而更改。' : '写下一个想法，再把图片或文档附在里面。'}</p>{query && <button className="records-button secondary" onClick={() => setQuery('')}>清空筛选</button>}</div> : <ul className="record-list">{visible.map((note, index) => <li key={note.id}><button className={'record-row' + (selected?.id === note.id ? ' selected' : '')} onClick={() => select(note)} disabled={saving || fileBusy || creating} aria-current={selected?.id === note.id ? 'true' : undefined}><span className="record-number">{String(index + 1).padStart(2, '0')}</span><span className="record-row-text"><strong>{note.title}</strong><small>个人记录 · 版本 {note.version}</small></span><time>{date(note.created_at)}</time><span className="row-arrow" aria-hidden="true">↗</span></button></li>)}</ul>}
          <footer className="records-list-footer">{notes.length} 条已载入 <span>选择一条记录，继续完善它</span></footer>
        </section>
        {selected && <aside ref={detail} tabIndex={-1} className="record-detail" aria-label="记录详情"><div className="detail-heading"><span>记录详情</span><button className="icon-button" aria-label="关闭记录详情" disabled={saving || fileBusy} onClick={() => { selectedRef.current = null; fileEpoch.current++; setSelected(null); }}>×</button></div><p className="detail-meta">创建于 {date(selected.created_at)} · 版本 {selected.version}</p>
          <form onSubmit={event => { event.preventDefault(); void save(); }}><label htmlFor="record-title">标题</label><textarea id="record-title" maxLength={300} value={editTitle} disabled={saving || creating} onChange={event => setEditTitle(event.target.value)} /><div className="detail-form-footer"><span>{editTitle.length}/300</span><button className="records-button" disabled={saving || creating || fileBusy || editBlocked || !editTitle.trim() || editTitle.trim() === selected.title}>{saving ? '保存中…' : '保存修改'}</button></div></form>
          {editError && <div className="records-alert" role="alert">{editError}</div>}{editBlocked && <button className="records-button secondary" disabled={saving} onClick={() => void reconcileEdit()}>读取最新内容并核对</button>}
          <section className="attachment-section" aria-label="记录附件"><div className="attachment-heading"><h3>附件 <span>{attachments.length}</span></h3><button className="text-button" disabled={filesLoading || fileBusy} onClick={() => void loadFiles(selected.id)}>重新读取附件</button></div><p>PNG、JPEG 或 PDF · 每个文件不超过 5 MB</p><label className={'file-drop' + (fileBusy || upload ? ' disabled' : '')}><span aria-hidden="true">＋</span><strong>选择文件添加到这条记录</strong><small>上传后会核对文件大小与类型</small><input aria-label="添加附件" type="file" accept="image/png,image/jpeg,application/pdf" disabled={fileBusy || !!upload || saving || creating} onChange={event => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ''; }} /></label>
            {upload?.noteId === selected.id && <div className="upload-progress" role="status"><strong>{upload.name}</strong><p>{fileBusy ? upload.phase === 'uploading' ? `上传中 ${progress}%` : '正在确认文件…' : '等待核对上传结果'}</p><progress max={100} value={progress} />{!fileBusy && <span><button className="records-button secondary" onClick={() => void confirm(upload)}>核对上传结果</button><button className="text-button" onClick={() => { setUpload(null); setFilesError("已结束本次上传。待确认记录仍保留；未上传成功的文件需要另行添加，旧记录由应用清理策略处理。"); void loadFiles(selected.id); }}>结束本次上传</button></span>}</div>}{filesError && <div className="records-alert" role="alert">{filesError}</div>}
            {filesLoading ? <p role="status" className="attachment-empty">正在读取附件…</p> : attachments.length === 0 ? <p className="attachment-empty">还没有附件。</p> : <ul className="attachment-list">{attachments.map(file => <li key={file.id}><span className="attachment-icon" aria-hidden="true">▧</span><div><strong>附件 {file.id.slice(0, 8)}</strong><small>{date(file.created_at)} · {file.status === 'ready' ? '已确认' : '待确认'}</small></div>{file.status === 'ready' ? <button className="text-button" onClick={() => void download(file)}>下载</button> : <button className="text-button" disabled={fileBusy} onClick={() => void confirm({ id: file.id, noteId: selected.id, owner, name: '待确认附件', phase: 'confirm' })}>核对</button>}</li>)}</ul>}
          </section>
        </aside>}
      </div><footer className="records-page-footer"><span>拾页 · 为每一个想法留一页</span><span>记录私有，思绪自由。</span></footer>
    </main>
  </div>;
}
