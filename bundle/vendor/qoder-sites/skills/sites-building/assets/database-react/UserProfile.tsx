import { useEffect, useRef, useState } from 'react';
import { ApiError, requestJson, isWriteOutcomeUnknown } from './api';
type Profile = { user: { id: string; name: string; picture: string }; profile: { display_name: string } | null };
function parse(value: unknown): Profile {
  const data = value as Profile;
  if (!data?.user || typeof data.user.id !== 'string' || typeof data.user.name !== 'string'
      || typeof data.user.picture !== 'string' || (data.profile !== null && typeof data.profile?.display_name !== 'string')) throw new ApiError('Invalid response', 'invalid_response');
  return data;
}
const messages = { invalid_input: 'Enter a site display name of at most 128 UTF-8 bytes.', profile_unavailable: 'The result is unavailable. Reload to check before saving again.', write_rejected: 'The save was rejected. Correct the input or access before retrying.', write_result_unknown: 'The save result is unknown. Reload to check before saving again.' };
export default function App() {
  const [data, setData] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  const endpoint = '/functions/v1/app?action=profile';
  async function run(save: boolean) {
    if (pending.current || (save && unconfirmed)) return;
    pending.current = true;
    const generation = ++sequence.current;
    const intendedName = name.trim();
    const expectedUser = data?.user.id;
    setBusy(true); setError(''); setStatus(''); setUnauthorized(false);
    try {
      const next = parse(await requestJson(endpoint, save ? { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: name }) } : {}, messages));
      if (generation !== sequence.current) return;
      // The write returns the persisted row. No second write on a read/transport failure.
      setUnconfirmed(false);
      setData(next); setName(next.profile?.display_name ?? ''); setStatus(save ? 'Saved to this site.' : '');
    } catch (cause) {
      if (generation !== sequence.current) return;
      if (save && isWriteOutcomeUnknown(cause)) {
        setUnconfirmed(true);
        try {
          const current = parse(await requestJson(endpoint, {}, messages));
          if (generation !== sequence.current) return;
          if (current.user.id !== expectedUser) { setData(null); setName(''); setError('Account changed. Reload before saving.'); return; }
          setData(current); setUnconfirmed(false);
          if (current.profile?.display_name === intendedName) {
            setName(intendedName); setStatus('The current saved value matches your change.'); return;
          }
        } catch (readError) {
          if (readError instanceof ApiError && (readError.status === 401 || readError.status === 403)) {
            setData(null); setName(''); setUnauthorized(readError.status === 401);
          }
          // Keep an unresolved write blocked until Reload succeeds.
        }
        setError('The save could not be confirmed. Reload to check before saving again.');
      } else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setData(null); setName(''); setUnauthorized(cause.status === 401);
        setError(cause.status === 401 ? 'Sign in to continue.' : 'Access could not be verified.');
      } else setError(cause instanceof Error ? cause.message : 'The service is unavailable.');
    } finally {
      if (generation === sequence.current) { pending.current = false; setBusy(false); }
    }
  }
  useEffect(() => { void run(false); return () => { ++sequence.current; pending.current = false; }; }, []);
  const avatar = data?.user.picture.startsWith('https://') ? data.user.picture : undefined;
  return <main className="mx-auto max-w-xl space-y-4 p-8">
    <h1>My site profile</h1>
    {data && <div>{avatar && <img src={avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" />}<p>Qoder account: {data.user.name || data.user.id}</p></div>}
    {busy && <p role="status">Loading…</p>}
    {error && <p role="alert">{error}</p>}
    {unauthorized && <a href="/__qoder_auth/start?return_path=%2F">Sign in with Qoder</a>}
    <button disabled={busy} onClick={() => void run(false)}>Reload</button>
    {data && <form onSubmit={event => { event.preventDefault(); void run(true); }}>
      <label>Site display name<input value={name} onChange={event => setName(event.target.value)} disabled={busy} required /></label>
      <p>This updates this website’s profile, not your Qoder account.</p>
      <button disabled={busy || unconfirmed || !name.trim()} type="submit">Save</button>
    </form>}
    {status && <p role="status">{status}</p>}
  </main>;
}
