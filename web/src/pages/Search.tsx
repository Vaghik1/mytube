import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { search } from '../api';
import { PagedGrid } from '../components/VideoGrid';
import { canVoiceSearch, listen } from '../voice';

const KEY = 'mytube.recentSearches';
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
};

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [text, setText] = useState(q);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [listening, setListening] = useState(false);
  const voice = canVoiceSearch();

  const run = (query: string) => {
    const s = query.trim();
    if (!s) return;
    const r = [s, ...recent.filter((x) => x !== s)].slice(0, 12);
    setRecent(r);
    localStorage.setItem(KEY, JSON.stringify(r));
    setText(s);
    setParams({ q: s });
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const speak = async () => {
    setListening(true);
    const said = await listen();
    setListening(false);
    if (said) run(said);
  };
  // Opened with the remote's search/mic key: start listening right away.
  useEffect(() => {
    if (params.get('voice') === '1' && voice) {
      params.delete('voice');
      setParams(params, { replace: true });
      speak();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('voice')]);

  return (
    <div className="page">
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <input
          className="focusable search-input"
          data-autofocus={(!q && !voice) || undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? 'Listening…' : 'Search YouTube'}
          enterKeyHint="search"
        />
        {voice && (
          <button
            className={`btn focusable mic${listening ? ' on' : ''}`}
            type="button"
            data-autofocus={!q || undefined}
            onClick={speak}
            aria-label="Search by voice"
          >
            🎤
          </button>
        )}
        <button className="btn focusable" type="submit">
          Search
        </button>
      </form>
      {!q && recent.length > 0 && (
        <>
          <h2 className="section-title">Recent searches</h2>
          <div className="chips wrap">
            {recent.map((r) => (
              <button key={r} className="chip focusable" onClick={() => run(r)}>
                {r}
              </button>
            ))}
          </div>
        </>
      )}
      {q && <PagedGrid load={(t) => search(q, t)} deps={[q]} title={`Search: ${q}`} empty="No results" />}
    </div>
  );
}
