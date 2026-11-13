import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSubscriptionFeed, getSubscriptions, type Channel, type Video } from '../api';
import { Status, VideoGrid } from '../components/VideoGrid';

export function Subscriptions() {
  const nav = useNavigate();
  const [subs, setSubs] = useState<Channel[]>([]);
  const [feed, setFeed] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getSubscriptions(200), getSubscriptionFeed()])
      .then(([s, f]) => {
        setSubs(s);
        setFeed(f);
        setError(undefined);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="page">
      {subs.length > 0 && (
        <div className="channel-row">
          {subs.map((c) => (
            <button key={c.id} className="channel-chip focusable" onClick={() => nav(`/channel/${c.id}`)}>
              <img src={c.thumb} alt="" loading="lazy" />
              <span>{c.title}</span>
            </button>
          ))}
        </div>
      )}
      <h2 className="section-title">Latest</h2>
      <VideoGrid videos={feed} title="Subscriptions" />
      <Status loading={loading} error={error} empty={!loading && !error && !feed.length ? 'No videos yet' : undefined} />
    </div>
  );
}
