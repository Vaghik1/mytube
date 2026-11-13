// YouTube Data API v3 wrapper. Daily quota is 10,000 units: most calls cost 1, search costs 100.
import { getAccessToken } from './auth';
import { loadSettings } from './config';

const BASE = 'https://www.googleapis.com/youtube/v3/';

export type Video = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumb: string;
  duration: number; // seconds
  views: number;
  likes: number;
  live: boolean;
  description: string;
};

export type Channel = {
  id: string;
  title: string;
  thumb: string;
  subscribers?: number;
  videoCount?: number;
  description?: string;
  uploads?: string;
  banner?: string;
};

export type Playlist = { id: string; title: string; thumb: string; count: number };
export type Page<T> = { items: T[]; next?: string };

export class ApiError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
}

async function yt<T = any>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  init: RequestInit = {},
): Promise<T> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
  const doFetch = async (force: boolean) => {
    const token = await getAccessToken(force);
    if (!token) throw new ApiError(401, 'signedOut', 'Not signed in');
    return fetch(`${BASE}${path}?${qs}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  };
  let res = await doFetch(false);
  if (res.status === 401) res = await doFetch(true);
  if (res.status === 204) return {} as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.errors?.[0]?.reason || 'error', err?.message || `HTTP ${res.status}`);
  }
  return data as T;
}

// ── small helpers ────────────────────────────────────────────

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const k = `mytube.cache.${key}`;
  try {
    const hit = JSON.parse(localStorage.getItem(k) || 'null');
    if (hit && hit.t + ttlMs > Date.now()) return Promise.resolve(hit.v as T);
  } catch {
    /* ignore */
  }
  return fn().then((v) => {
    try {
      localStorage.setItem(k, JSON.stringify({ t: Date.now(), v }));
    } catch {
      /* storage full: ignore */
    }
    return v;
  });
}

export function clearCache(prefix = '') {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(`mytube.cache.${prefix}`))
    .forEach((k) => localStorage.removeItem(k));
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

function parseDuration(iso?: string): number {
  if (!iso) return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + mi * 60 + s;
}

function bestThumb(t: any): string {
  return t?.high?.url || t?.medium?.url || t?.default?.url || '';
}

function toVideo(v: any): Video {
  return {
    id: typeof v.id === 'string' ? v.id : v.id?.videoId,
    title: v.snippet?.title || '',
    channelId: v.snippet?.channelId || '',
    channelTitle: v.snippet?.channelTitle || '',
    publishedAt: v.snippet?.publishedAt || '',
    thumb: `https://i.ytimg.com/vi/${typeof v.id === 'string' ? v.id : v.id?.videoId}/mqdefault.jpg`,
    duration: parseDuration(v.contentDetails?.duration),
    views: Number(v.statistics?.viewCount || 0),
    likes: Number(v.statistics?.likeCount || 0),
    live: v.snippet?.liveBroadcastContent === 'live',
    description: v.snippet?.description || '',
  };
}

/** Applies your personal filters from config.ts / Settings. */
export function applyFilters(videos: Video[]): Video[] {
  const s = loadSettings();
  const words = s.blockedKeywords.map((w) => w.toLowerCase()).filter(Boolean);
  const chans = new Set(s.blockedChannels.map((c) => c.toLowerCase()));
  return videos.filter((v) => {
    if (!v.id || v.title === 'Private video' || v.title === 'Deleted video') return false;
    if (s.hideShorts && !v.live && v.duration > 0 && v.duration <= 180) return false;
    if (chans.has(v.channelId.toLowerCase()) || chans.has(v.channelTitle.toLowerCase())) return false;
    const t = v.title.toLowerCase();
    return !words.some((w) => t.includes(w));
  });
}

// ── videos ───────────────────────────────────────────────────

const VPARTS = 'snippet,contentDetails,statistics';

export async function getVideos(ids: string[]): Promise<Video[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const pages = await Promise.all(
    chunk(unique, 50).map((c) => yt('videos', { part: VPARTS, id: c.join(','), maxResults: 50 })),
  );
  const map = new Map<string, Video>();
  pages.flatMap((p) => p.items || []).forEach((v: any) => map.set(v.id, toVideo(v)));
  return unique.map((id) => map.get(id)).filter(Boolean) as Video[];
}

export async function getVideo(id: string): Promise<Video | undefined> {
  return (await getVideos([id]))[0];
}

export async function getPopular(categoryId?: string, pageToken?: string): Promise<Page<Video>> {
  const { region } = loadSettings();
  const run = (regionCode: string) =>
    yt('videos', {
      part: VPARTS,
      chart: 'mostPopular',
      regionCode,
      videoCategoryId: categoryId,
      maxResults: 24,
      pageToken,
    });
  let data = await run(region);
  if (!data.items?.length && region !== 'US' && !pageToken) data = await run('US');
  return { items: applyFilters((data.items || []).map(toVideo)), next: data.nextPageToken };
}

export async function getCategories(): Promise<{ id: string; title: string }[]> {
  const { region } = loadSettings();
  return cached(`cats.${region}`, 7 * 86400_000, async () => {
    const data = await yt('videoCategories', { part: 'snippet', regionCode: region, hl: 'en' });
    return (data.items || [])
      .filter((c: any) => c.snippet?.assignable)
      .map((c: any) => ({ id: c.id, title: c.snippet.title }));
  });
}

export async function search(q: string, pageToken?: string): Promise<Page<Video>> {
  const data = await yt('search', { part: 'snippet', type: 'video', q, maxResults: 24, pageToken });
  const ids = (data.items || []).map((i: any) => i.id?.videoId);
  return { items: applyFilters(await getVideos(ids)), next: data.nextPageToken };
}

// ── me / subscriptions ───────────────────────────────────────

export async function getMe(): Promise<Channel | undefined> {
  return cached('me', 86400_000, async () => {
    const data = await yt('channels', { part: 'snippet', mine: true });
    const c = data.items?.[0];
    return c ? { id: c.id, title: c.snippet.title, thumb: bestThumb(c.snippet.thumbnails) } : undefined;
  });
}

export async function getSubscriptions(max = 200): Promise<Channel[]> {
  return cached(`subs.${max}`, 6 * 3600_000, async () => {
    const out: Channel[] = [];
    let pageToken: string | undefined;
    do {
      const data = await yt('subscriptions', {
        part: 'snippet',
        mine: true,
        order: 'relevance',
        maxResults: 50,
        pageToken,
      });
      (data.items || []).forEach((s: any) =>
        out.push({
          id: s.snippet.resourceId.channelId,
          title: s.snippet.title,
          thumb: bestThumb(s.snippet.thumbnails),
        }),
      );
      pageToken = data.nextPageToken;
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  });
}

/** Latest uploads from your subscriptions (YouTube's API has no personal home feed, so we build one). */
export async function getSubscriptionFeed(): Promise<Video[]> {
  const { feedChannelLimit } = loadSettings();
  const vids = await cached(`subfeed.${feedChannelLimit}`, 20 * 60_000, async () => {
    const subs = await getSubscriptions(feedChannelLimit);
    const chans = await Promise.all(
      chunk(subs.map((s) => s.id), 50).map((c) => yt('channels', { part: 'contentDetails', id: c.join(',') })),
    );
    const uploads: string[] = chans
      .flatMap((p) => p.items || [])
      .map((c: any) => c.contentDetails?.relatedPlaylists?.uploads)
      .filter(Boolean);
    const items = await pool(uploads, 8, (pl) =>
      yt('playlistItems', { part: 'contentDetails', playlistId: pl, maxResults: 5 }).catch(() => ({ items: [] })),
    );
    const recent = items
      .flatMap((p: any) => p.items || [])
      .map((i: any) => ({ id: i.contentDetails.videoId, at: i.contentDetails.videoPublishedAt || '' }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 100);
    return getVideos(recent.map((r) => r.id));
  });
  return applyFilters(vids);
}

/** "For you": your subscriptions' new uploads mixed with trending. */
export async function getForYou(): Promise<Video[]> {
  const { subsPerTrending } = loadSettings();
  const [subs, trending] = await Promise.all([
    getSubscriptionFeed().catch(() => [] as Video[]),
    cached(`trend.${loadSettings().region}`, 30 * 60_000, () => getPopular().then((p) => p.items)).then(applyFilters),
  ]);
  const out: Video[] = [];
  const seen = new Set<string>();
  const push = (v?: Video) => v && !seen.has(v.id) && (seen.add(v.id), out.push(v));
  let si = 0;
  let ti = 0;
  while (si < subs.length || ti < trending.length) {
    for (let k = 0; k < Math.max(1, subsPerTrending); k++) push(subs[si++]);
    push(trending[ti++]);
  }
  return out;
}

export async function isSubscribed(channelId: string): Promise<string | null> {
  const data = await yt('subscriptions', { part: 'id', mine: true, forChannelId: channelId });
  return data.items?.[0]?.id || null;
}

export async function subscribe(channelId: string): Promise<string> {
  clearCache('sub');
  const data = await yt(
    'subscriptions',
    { part: 'snippet' },
    {
      method: 'POST',
      body: JSON.stringify({ snippet: { resourceId: { kind: 'youtube#channel', channelId } } }),
    },
  );
  return data.id;
}

export async function unsubscribe(subscriptionId: string) {
  clearCache('sub');
  await yt('subscriptions', { id: subscriptionId }, { method: 'DELETE' });
}

// ── ratings / library ────────────────────────────────────────

export async function getRating(id: string): Promise<'like' | 'dislike' | 'none'> {
  const data = await yt('videos/getRating', { id });
  return data.items?.[0]?.rating || 'none';
}

export async function rate(id: string, rating: 'like' | 'dislike' | 'none') {
  clearCache('liked');
  await yt('videos/rate', { id, rating }, { method: 'POST' });
}

export async function getLiked(pageToken?: string): Promise<Page<Video>> {
  const data = await yt('videos', { part: VPARTS, myRating: 'like', maxResults: 24, pageToken });
  return { items: applyFilters((data.items || []).map(toVideo)), next: data.nextPageToken };
}

export async function getMyPlaylists(): Promise<Playlist[]> {
  return cached('playlists', 3600_000, async () => {
    const data = await yt('playlists', { part: 'snippet,contentDetails', mine: true, maxResults: 50 });
    return (data.items || []).map((p: any) => ({
      id: p.id,
      title: p.snippet.title,
      thumb: p.snippet.thumbnails?.medium?.url || bestThumb(p.snippet.thumbnails),
      count: p.contentDetails?.itemCount || 0,
    }));
  });
}

export async function getPlaylistInfo(id: string): Promise<Playlist | undefined> {
  const data = await yt('playlists', { part: 'snippet,contentDetails', id });
  const p = data.items?.[0];
  return p && { id: p.id, title: p.snippet.title, thumb: bestThumb(p.snippet.thumbnails), count: p.contentDetails?.itemCount };
}

export async function getPlaylistVideos(playlistId: string, pageToken?: string): Promise<Page<Video>> {
  const data = await yt('playlistItems', { part: 'contentDetails', playlistId, maxResults: 24, pageToken });
  const ids = (data.items || []).map((i: any) => i.contentDetails.videoId);
  return { items: applyFilters(await getVideos(ids)), next: data.nextPageToken };
}

// ── channels ─────────────────────────────────────────────────

export async function getChannel(id: string): Promise<Channel | undefined> {
  return cached(`channel.${id}`, 6 * 3600_000, async () => {
    const data = await yt('channels', { part: 'snippet,statistics,contentDetails,brandingSettings', id });
    const c = data.items?.[0];
    if (!c) return undefined;
    return {
      id: c.id,
      title: c.snippet.title,
      thumb: bestThumb(c.snippet.thumbnails),
      description: c.snippet.description,
      subscribers: Number(c.statistics?.subscriberCount || 0),
      videoCount: Number(c.statistics?.videoCount || 0),
      uploads: c.contentDetails?.relatedPlaylists?.uploads,
      banner: c.brandingSettings?.image?.bannerExternalUrl,
    };
  });
}

export async function getChannelVideos(channelId: string, pageToken?: string): Promise<Page<Video>> {
  const ch = await getChannel(channelId);
  if (!ch?.uploads) return { items: [] };
  return getPlaylistVideos(ch.uploads, pageToken);
}
