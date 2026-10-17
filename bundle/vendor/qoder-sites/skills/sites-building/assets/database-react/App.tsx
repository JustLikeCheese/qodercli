import { useEffect, useState } from 'react';
import { requestJson } from './api';

type Note = { id: string; title: string; created_at: string };
type Page = { items: Note[]; hasMore: boolean; nextOffset: number | null };

// Public read-only records. This component does not establish visitor identity.
export default function App() {
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(false);
    setPage(null);
    void (async () => {
      try {
        const data = await requestJson(`/functions/v1/app?action=list&offset=${offset}`, {
          signal: controller.signal,
        });
        if (!data || typeof data !== 'object') throw Error('invalid_response');
        const candidate = data as Partial<Page>;
        const validItems = Array.isArray(candidate.items) && candidate.items.every(item =>
          item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.created_at === 'string',
        );
        const validNextOffset = candidate.hasMore
          ? Number.isSafeInteger(candidate.nextOffset) && Number(candidate.nextOffset) > offset
          : candidate.nextOffset === null;
        if (!validItems || typeof candidate.hasMore !== 'boolean' || !validNextOffset) throw Error('invalid_response');
        if (current) setPage(candidate as Page);
      } catch {
        if (current) setError(true);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [offset, retry]);
  return <main className="mx-auto max-w-3xl space-y-6 p-8">
    <h1 className="text-3xl font-semibold">Notes</h1>
    {loading && <p role="status">Loading notes…</p>}
    {error && <div role="alert"><p>Notes could not be loaded.</p><button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {page && !loading && <>
      {page.items.length ? <ul className="space-y-3">{page.items.map(note => <li key={note.id} className="rounded border p-4">{note.title}</li>)}</ul> : <p>No notes yet.</p>}
    </>}
    <nav aria-label="Notes pages" className="flex gap-4">
      <button disabled={loading || offset === 0} onClick={() => setOffset(0)}>First page</button>
      <button disabled={loading || !page?.hasMore} onClick={() => { if (page?.nextOffset != null) setOffset(page.nextOffset); }}>Next page</button>
    </nav>
  </main>;
}
