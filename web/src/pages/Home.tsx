import { useEffect, useState } from 'react';
import { getCategories, getForYou, getPopular, getSubscriptionFeed, type Video } from '../api';
import { PagedGrid, Status, VideoGrid } from '../components/VideoGrid';
import { useNavigate } from 'react-router-dom';
import { getLiveNow, getPickVideos, getPicks, type AgentPick } from '../agent';
import { VideoCard } from '../components/VideoCard';
import { focusEl } from '../tv';
import type { Video as V } from '../api';

type Chip = { id: string; title: string };
const FIXED: Chip[] = [
  { id: 'foryou', title: 'For you' },
  { id: 'chatgpt', title: '✨ From ChatGPT' },
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
      <LiveNow />
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
      {chip === 'chatgpt' && <ChatGptPicks />}
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

function ChatGptPicks() {
  const nav = useNavigate();
  const [searches, setSearches] = useState<AgentPick[]>([]);
  useEffect(() => {
    getPicks(true)
      .then((p) => setSearches(p.filter((x) => x.type === 'search')))
      .catch(() => {});
  }, []);
  return (
    <>
      {searches.length > 0 && (
        <>
          <h2 className="section-title">Topics ChatGPT suggests</h2>
          <div className="chips wrap">
            {searches.map((p) => (
              <button key={p.id} className="chip focusable" onClick={() => nav(`/search?q=${encodeURIComponent(p.query || '')}`)}>
                {p.query}
              </button>
            ))}
          </div>
        </>
      )}
      <ListFeed
        load={getPickVideos}
        title="From ChatGPT"
        empty="No picks yet. Once ChatGPT is connected, its suggestions show up here."
      />
    </>
  );
}

/** Live and soon-starting streams, shown above everything else. Refreshes every 2 minutes. */
function LiveNow() {
  const [data, setData] = useState<{ live: V[]; soon: V[] }>({ live: [], soon: [] });
  useEffect(() => {
    let alive = true;
    let first = true;
    const load = (fresh: boolean) =>
      getLiveNow(fresh)
        .then((d) => {
          if (!alive) return;
          setData(d);
          // On opening MyTube, jump straight to the live stream unless you've already moved.
          if (first && (d.live.length || d.soon.length)) {
            requestAnimationFrame(() => {
              const a = document.activeElement;
              if (!a || a === document.body || a.closest('.chips')) {
                focusEl(document.querySelector<HTMLElement>('.live-row .card'));
                document.querySelector('main')?.scrollTo({ top: 0 });
              }
            });
          }
          first = false;
        })
        .catch(() => {});
    load(false);
    const t = window.setInterval(() => load(true), 2 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const { live, soon } = data;
  if (!live.length && !soon.length) return null;
  return (
    <>
      {live.length > 0 && (
        <>
          <h2 className="section-title live-title">● Live now</h2>
          <div className={`live-row${live.length <= 2 ? ' big' : ''}`}>
            {live.map((v, i) => (
              <VideoCard key={v.id} v={v} queue={{ ids: live.map((x) => x.id), index: i }} autoFocus={i === 0} />
            ))}
          </div>
        </>
      )}
      {soon.length > 0 && (
        <>
          <h2 className="section-title">Starting soon</h2>
          <div className="live-row">
            {soon.map((v, i) => (
              <VideoCard key={v.id} v={v} queue={{ ids: soon.map((x) => x.id), index: i }} autoFocus={!live.length && i === 0} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
