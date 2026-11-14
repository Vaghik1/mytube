import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearCache, listAllSubscriptions, searchChannels, subscribe, unsubscribe, type Channel } from '../api';
import { Status } from '../components/VideoGrid';
import { fmtCount } from '../util';

type Sort = 'relevance' | 'az';

/** Manage your subscriptions: browse, unsubscribe (one or many), find and add channels. */
export function Subscriptions() {
  const nav = useNavigate();
  const [subs, setSubs] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [sort, setSort] = useState<Sort>('relevance');
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Channel[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    listAllSubscriptions()
      .then((s) => (setSubs(s), setError(undefined)))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(
    () => (sort === 'az' ? [...subs].sort((a, b) => a.title.localeCompare(b.title)) : subs),
    [subs, sort],
  );
  const subscribedIds = useMemo(() => new Map(subs.map((s) => [s.id, s])), [subs]);

  const toggle = (id: string) => {
    setConfirming(false);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const removeSelected = async () => {
    if (!confirming) return setConfirming(true);
    setBusy(true);
    const targets = subs.filter((s) => selected.has(s.id) && s.subId);
    const removed = new Set<string>();
    for (const s of targets) {
      try {
        await unsubscribe(s.subId!);
        removed.add(s.id);
      } catch {
        /* keep it in the list */
      }
    }
    clearCache('sub');
    setSubs((prev) => prev.filter((s) => !removed.has(s.id)));
    setSelected(new Set());
    setConfirming(false);
    setBusy(false);
    setMessage(
      removed.size === targets.length
        ? `Unsubscribed from ${removed.size} channel${removed.size === 1 ? '' : 's'}.`
        : `Unsubscribed from ${removed.size} of ${targets.length}; try the rest again.`,
    );
    if (!subs.length || removed.size === subs.length) setManaging(false);
  };

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return setResults(null);
    setSearching(true);
    try {
      setResults(await searchChannels(q));
    } catch (err) {
      setError(err);
    } finally {
      setSearching(false);
    }
  };

  const toggleSubscribe = async (c: Channel) => {
    const existing = subscribedIds.get(c.id);
    try {
      if (existing?.subId) {
        await unsubscribe(existing.subId);
        setSubs((prev) => prev.filter((s) => s.id !== c.id));
        setMessage(`Unsubscribed from ${c.title}.`);
      } else {
        const subId = await subscribe(c.id);
        setSubs((prev) => [{ ...c, subId }, ...prev]);
        setMessage(`Subscribed to ${c.title}.`);
      }
      clearCache('sub');
    } catch {
      setMessage(`Couldn't update ${c.title}. Try again.`);
    }
  };

  return (
    <div className="page">
      <form className="search-bar" onSubmit={runSearch}>
        <input
          className="focusable search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find channels to subscribe"
          enterKeyHint="search"
        />
        <button className="btn focusable" type="submit">
          Search
        </button>
      </form>

      {searching && <Status loading />}
      {results && !searching && (
        <>
          <div className="row between">
            <h2 className="section-title">Channels</h2>
            <button className="btn focusable" onClick={() => (setResults(null), setQuery(''))}>
              Close
            </button>
          </div>
          {results.length === 0 && <p className="muted">No channels found.</p>}
          <div className="sub-list">
            {results.map((c) => {
              const isSub = subscribedIds.has(c.id);
              return (
                <div key={c.id} className="sub-row">
                  <button className="sub-main focusable" onClick={() => nav(`/channel/${c.id}`)}>
                    <img src={c.thumb} alt="" loading="lazy" />
                    <span className="sub-text">
                      <span className="sub-title">{c.title}</span>
                      <span className="card-meta">{fmtCount(c.subscribers || 0)} subscribers</span>
                    </span>
                  </button>
                  <button className={`btn focusable${isSub ? '' : ' primary'}`} onClick={() => toggleSubscribe(c)}>
                    {isSub ? 'Subscribed ✓' : 'Subscribe'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="row between">
        <h2 className="section-title">Your subscriptions{subs.length ? ` (${subs.length})` : ''}</h2>
        <div className="row">
          <button className={`chip focusable${sort === 'relevance' ? ' active' : ''}`} onClick={() => setSort('relevance')}>
            Most relevant
          </button>
          <button className={`chip focusable${sort === 'az' ? ' active' : ''}`} onClick={() => setSort('az')}>
            A–Z
          </button>
          <button
            className={`chip focusable${managing ? ' active' : ''}`}
            onClick={() => {
              setManaging(!managing);
              setSelected(new Set());
              setConfirming(false);
            }}
          >
            {managing ? 'Done' : 'Manage'}
          </button>
        </div>
      </div>

      {message && <p className="muted">{message}</p>}

      {managing && (
        <div className="row manage-bar">
          <span className="muted">{selected.size} selected</span>
          <button className="btn focusable" onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>
            Select all
          </button>
          <button className="btn focusable" disabled={!selected.size} onClick={() => (setSelected(new Set()), setConfirming(false))}>
            Clear
          </button>
          <button className={`btn focusable${confirming ? ' danger' : ''}`} disabled={!selected.size || busy} onClick={removeSelected}>
            {busy ? 'Unsubscribing…' : confirming ? `Confirm: unsubscribe ${selected.size}` : `Unsubscribe (${selected.size})`}
          </button>
        </div>
      )}

      <div className="sub-list">
        {shown.map((c) => (
          <div key={c.id} className={`sub-row${selected.has(c.id) ? ' selected' : ''}`}>
            <button
              className="sub-main focusable"
              aria-pressed={managing ? selected.has(c.id) : undefined}
              onClick={() => (managing ? toggle(c.id) : nav(`/channel/${c.id}`))}
            >
              {managing && <span className="check">{selected.has(c.id) ? '☑' : '☐'}</span>}
              <img src={c.thumb} alt="" loading="lazy" />
              <span className="sub-text">
                <span className="sub-title">{c.title}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
      <Status loading={loading} error={error} empty={!loading && !error && !subs.length ? 'No subscriptions yet. Search above to add channels.' : undefined} />
    </div>
  );
}
