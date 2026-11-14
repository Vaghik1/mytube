import { useEffect, useState } from 'react';
import { getForYou, type Video } from '../api';
import { Status, VideoGrid } from '../components/VideoGrid';

/**
 * Home is one list of videos: live streams worth watching, ChatGPT's picks and
 * everything learned from what you watch, all mixed into a single feed.
 */
export function Home() {
  const [items, setItems] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    getForYou()
      .then((v) => alive && (setItems(v), setError(undefined)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="page">
      <VideoGrid videos={items} title="For you" autoFocusFirst />
      <Status loading={loading} error={error} empty={!loading && !error && !items.length ? 'Nothing to show yet' : undefined} />
    </div>
  );
}
