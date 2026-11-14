import { useCallback, useEffect, useRef, useState } from 'react';
import { recordImpression } from '../impressions';
import type { Page, Video } from '../api';
import { errorText } from '../util';
import { VideoCard } from './VideoCard';

export function Status({ loading, error, empty }: { loading?: boolean; error?: unknown; empty?: string }) {
  if (loading) return <div className="status"><div className="spinner" /></div>;
  if (error) return <div className="status error">{errorText(error)}</div>;
  if (empty) return <div className="status">{empty}</div>;
  return null;
}

/** Time a card must stay on screen to count as "seen in the list". */
export const IMPRESSION_MS = 1000;

/** Notes which cards stay on screen for a moment (For you only). */
function useImpressions(ref: React.RefObject<HTMLDivElement | null>, on: boolean, deps: unknown) {
  useEffect(() => {
    const root = ref.current;
    if (!on || !root || typeof IntersectionObserver === 'undefined') return;
    const timers = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.videoId;
          if (!id) continue;
          if (e.isIntersecting) {
            if (!timers.has(e.target)) timers.set(e.target, window.setTimeout(() => recordImpression(id), IMPRESSION_MS));
          } else {
            window.clearTimeout(timers.get(e.target));
            timers.delete(e.target);
          }
        }
      },
      { threshold: 0.6 },
    );
    root.querySelectorAll('[data-video-id]').forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [on, deps, ref]);
}

export function VideoGrid({
  videos,
  title,
  autoFocusFirst,
  trackImpressions,
}: {
  videos: Video[];
  title?: string;
  autoFocusFirst?: boolean;
  trackImpressions?: boolean;
}) {
  const ids = videos.map((v) => v.id);
  const ref = useRef<HTMLDivElement>(null);
  useImpressions(ref, !!trackImpressions, videos);
  return (
    <div className="grid" ref={ref}>
      {videos.map((v, i) => (
        <VideoCard key={`${v.id}-${i}`} v={v} queue={{ ids, index: i, title }} autoFocus={autoFocusFirst && i === 0} />
      ))}
    </div>
  );
}

/** Grid that loads the next page automatically when you reach the bottom with the remote. */
export function PagedGrid({
  load,
  deps,
  title,
  empty = 'Nothing here yet',
}: {
  load: (pageToken?: string) => Promise<Page<Video>>;
  deps: unknown[];
  title?: string;
  empty?: string;
}) {
  const [items, setItems] = useState<Video[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const busy = useRef(false);
  const gen = useRef(0);

  const fetchPage = useCallback(
    async (token?: string, reset = false) => {
      if (busy.current && !reset) return;
      busy.current = true;
      const my = reset ? ++gen.current : gen.current;
      setLoading(true);
      try {
        const page = await load(token);
        if (my !== gen.current) return;
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setNext(page.next);
        setError(undefined);
      } catch (e) {
        if (my === gen.current) setError(e);
      } finally {
        if (my === gen.current) {
          setLoading(false);
          busy.current = false;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    setItems([]);
    setNext(undefined);
    fetchPage(undefined, true);
  }, [fetchPage]);

  return (
    <>
      <VideoGrid videos={items} title={title} />
      <Status loading={loading} error={error} empty={!loading && !error && !items.length ? empty : undefined} />
      {next && !loading && (
        <button className="btn focusable more" onFocus={() => fetchPage(next)} onClick={() => fetchPage(next)}>
          Load more
        </button>
      )}
    </>
  );
}
