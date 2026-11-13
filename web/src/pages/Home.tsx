import { useEffect, useState } from 'react';
import { getCategories, getForYou, getPopular, getSubscriptionFeed, type Video } from '../api';
import { PagedGrid, Status, VideoGrid } from '../components/VideoGrid';

type Chip = { id: string; title: string };
const FIXED: Chip[] = [
  { id: 'foryou', title: 'For you' },
  { id: 'subs', title: 'New from subscriptions' },
  { id: 'trending', title: 'Trending' },
];

function ListFeed({ load, title, empty }: { load: () => Promise<Video[]>; title: string; empty: string }) {
  const [items, setItems] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setItems([]);
    load()
      .then((v) => alive && (setItems(v), setError(undefined)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);
  return (
    <>
      <VideoGrid videos={items} title={title} />
      <Status loading={loading} error={error} empty={!loading && !error && !items.length ? empty : undefined} />
    </>
  );
}

export function Home({ initial = 'foryou' }: { initial?: string }) {
  const [cats, setCats] = useState<Chip[]>([]);
  const [chip, setChip] = useState(initial);
  useEffect(() => setChip(initial), [initial]);
  useEffect(() => {
    getCategories().then(setCats).catch(() => setCats([]));
  }, []);

  const chips = [...FIXED, ...cats];
  const current = chips.find((c) => c.id === chip) || FIXED[0];

  return (
    <div className="page">
      <div className="chips">
        {chips.map((c) => (
          <button
            key={c.id}
            className={`chip focusable${c.id === chip ? ' active' : ''}`}
            data-autofocus={c.id === chip || undefined}
            onClick={() => setChip(c.id)}
          >
            {c.title}
          </button>
        ))}
      </div>
      {chip === 'foryou' && <ListFeed load={getForYou} title="For you" empty="Nothing to show yet" />}
      {chip === 'subs' && (
        <ListFeed load={getSubscriptionFeed} title="Subscriptions" empty="No new videos from your subscriptions" />
      )}
      {chip === 'trending' && <PagedGrid load={(t) => getPopular(undefined, t)} deps={['trending']} title="Trending" />}
      {!FIXED.some((f) => f.id === chip) && (
        <PagedGrid
          load={(t) => getPopular(chip, t)}
          deps={[chip]}
          title={current.title}
          empty="YouTube has no popular list for this category in your region"
        />
      )}
    </div>
  );
}
