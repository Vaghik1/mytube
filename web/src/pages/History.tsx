import type { Page, Video } from '../api';
import { PagedGrid } from '../components/VideoGrid';
import { loadHistory, type Watch } from '../history';

/** How many watched videos the History page keeps. */
export const HISTORY_LIMIT = 500;
const PAGE = 40;

/** A history entry as a card: thumbnail straight from YouTube's image server, no API quota needed. */
function toCard(w: Watch): Video {
  return {
    id: w.id,
    title: w.title,
    channelId: w.ch,
    channelTitle: w.cht,
    publishedAt: new Date(w.at).toISOString(),
    thumb: `https://i.ytimg.com/vi/${w.id}/hqdefault.jpg`,
    duration: w.dur,
    views: 0,
    likes: 0,
    live: false,
    description: '',
    watchedAt: w.at,
  };
}

/** Videos you actually played (not ones only marked "Not interested"), newest first. */
export function watchedVideos(): Video[] {
  return loadHistory()
    .filter((w) => w.sec >= 3)
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_LIMIT)
    .map(toCard);
}

export function History() {
  const load = async (token?: string): Promise<Page<Video>> => {
    const start = Number(token || 0);
    const all = watchedVideos();
    const end = start + PAGE;
    return { items: all.slice(start, end), next: end < all.length ? String(end) : undefined };
  };
  return (
    <div className="page">
      <h2 className="section-title">History</h2>
      <PagedGrid load={load} deps={[]} title="History" empty="Videos you watch on your TV or phone show up here." />
    </div>
  );
}
