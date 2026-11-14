import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { search } from '../api';
import { PagedGrid } from '../components/VideoGrid';

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
          data-autofocus={!q || undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search YouTube"
          enterKeyHint="search"
        />
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
