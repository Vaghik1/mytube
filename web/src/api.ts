// YouTube Data API v3 wrapper. Daily quota is 10,000 units: most calls cost 1, search costs 100.
import { getAccessToken } from './auth';
import { effectiveSettings, loadRemotePrefs, loadSettings } from './config';
import { buildProfile, seedQuery, seenIds, tokens, continueWatching } from './history';
import { demoteIgnored } from './impressions';

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
  /** Scheduled live stream that hasn't started yet. */
  upcoming?: boolean;
  /** When an upcoming stream is planned to start (ISO). */
  scheduledStart?: string;
  liveViewers?: number;
  description: string;
  categoryId?: string;
  tags?: string[];
  /** Why this was suggested (e.g. ChatGPT's reason). */
  note?: string;
  /** History page: when you last watched it (ms). */
  watchedAt?: number;
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
  /** Your subscription's id (needed to unsubscribe). */
  subId?: string;
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

export function chunk<T>(arr: T[], n: number): T[][] {
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

export function parseDuration(iso?: string): number {
  if (!iso) return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + mi * 60 + s;
}

function bestThumb(t: any): string {
  return t?.high?.url || t?.medium?.url || t?.default?.url || '';
}

export function toVideo(v: any): Video {
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
    upcoming: v.snippet?.liveBroadcastContent === 'upcoming' || undefined,
    scheduledStart: v.liveStreamingDetails?.scheduledStartTime,
    liveViewers: v.liveStreamingDetails?.concurrentViewers ? Number(v.liveStreamingDetails.concurrentViewers) : undefined,
    description: v.snippet?.description || '',
    categoryId: v.snippet?.categoryId,
    tags: v.snippet?.tags,
  };
}

/** Applies your personal filters (config.ts / Settings) and the ones ChatGPT set. */
export function applyFilters(videos: Video[]): Video[] {
  const s = effectiveSettings();
  const words = s.blockedKeywords.map((w) => w.toLowerCase()).filter(Boolean);
  const chans = new Set(s.blockedChannels.map((c) => c.toLowerCase().replace(/^@/, '')));
  // A disliked topic hides a video when all of its words appear in the title or tags.
  const disliked = s.dislikedTopics.map((t) => tokens(t)).filter((t) => t.length);
  return videos.filter((v) => {
    if (!v.id || v.title === 'Private video' || v.title === 'Deleted video') return false;
    if (s.hideShorts && !v.live && v.duration > 0 && v.duration <= 180) return false;
    if (chans.has(v.channelId.toLowerCase()) || chans.has(v.channelTitle.toLowerCase())) return false;
    const t = v.title.toLowerCase();
    if (words.some((w) => t.includes(w))) return false;
    if (disliked.length) {
      const have = new Set([...tokens(v.title), ...(v.tags || []).flatMap(tokens)]);
      if (disliked.some((topic) => topic.every((w) => have.has(w)))) return false;
    }
    return true;
  });
}

// ── videos ───────────────────────────────────────────────────

const VPARTS = 'snippet,contentDetails,statistics,liveStreamingDetails';

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

/** Streams that are live right now for a search phrase (100 units; callers cache it). */
export async function searchLive(q: string): Promise<Video[]> {
  const data = await yt('search', { part: 'snippet', type: 'video', eventType: 'live', q, maxResults: 10 });
  const ids = (data.items || []).map((i: any) => i.id?.videoId);
  return (await getVideos(ids)).filter((v) => v.live);
}

/** Cached wrapper used by the live row of the feed. */
export function cachedLiveSearch(q: string): Promise<Video[]> {
  return cached(`live.q.${q.toLowerCase()}`, 90 * 60_000, () => searchLive(q));
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
          subId: s.id,
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

/** Starter feed before MyTube has learned anything: only your own signals, no regional charts.
 *  New uploads from your subscriptions mixed with uploads from channels whose videos you liked. */
/** Your own videos and ChatGPT's, each in its own ranked list; getForYou merges them. */
type Streams = { mine: Video[]; gpt: Video[] };

/** Round-robin through several lists, skipping repeats and videos you've seen. */
function roundRobin(lists: Video[][], seen: Set<string>, ids = new Set<string>()): Video[] {
  const out: Video[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++)
    for (const l of lists) {
      const v = l[i];
      if (v && !ids.has(v.id) && !seen.has(v.id)) ids.add(v.id), out.push(v);
    }
  return applyFilters(out);
}

async function getStarterFeed(extra: Promise<Video[]>): Promise<Streams> {
  const [subs, liked] = await Promise.all([
    getSubscriptionFeed().catch(() => [] as Video[]),
    cached('fy.likedlist', 3600_000, () => getLiked().then((p) => p.items)).catch(() => [] as Video[]),
  ]);
  const prefs = await preferenceVideos().catch(() => ({ fromChannels: [] as Video[], fromInterests: [] as Video[], favIds: [] }));
  const likedCh = [...new Set(liked.map((v) => v.channelId))].slice(0, 8);
  const fromLiked = await cached(`fy.liked.${likedCh.join(',')}`, 3600_000, () => channelsUploads(likedCh, 6)).catch(
    () => [] as Video[],
  );
  const seen = seenIds();
  const ids = new Set<string>();
  const mine = roundRobin([subs, fromLiked], seen, ids);
  const gpt = roundRobin([prefs.fromChannels, prefs.fromInterests, await extra], seen, ids);
  return { mine, gpt };
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

// ── "For you": learned from what you watch ─────────────────────

/** Latest uploads from a list of channels (1 unit per channel + 1 per 50 for details). */
export async function channelsUploads(ids: string[], perChannel: number): Promise<Video[]> {
  if (!ids.length) return [];
  const chans = await yt('channels', { part: 'contentDetails', id: ids.slice(0, 50).join(',') });
  const uploads: string[] = (chans.items || [])
    .map((c: any) => c.contentDetails?.relatedPlaylists?.uploads)
    .filter(Boolean);
  const pages = await pool(uploads, 6, (pl) =>
    yt('playlistItems', { part: 'contentDetails', playlistId: pl, maxResults: perChannel }).catch(() => ({ items: [] })),
  );
  return getVideos(pages.flatMap((p: any) => (p.items || []).map((i: any) => i.contentDetails.videoId)));
}

// ── ChatGPT interests: rotating searches with a long-lived cache ──
// A search costs 100 of the 10,000 daily quota units, so MyTube searches only a few interests
// per half day, taking turns (never searched first, then the oldest). Every interest's results
// are kept for a week, so the feed draws on all of them, not only the ones searched today.
// Searches have their own 100-a-day allowance (shared by TV, phone, your own searches and live checks).
export const INTEREST_SEARCHES_PER_SLOT = 6;
export const INTEREST_SLOT_MS = 12 * 3600_000;
export const INTEREST_KEEP_MS = 7 * 86400_000;
const IQ = 'mytube.iq.'; // + interest → { t, v }
const IQ_LOG = 'mytube.iqlog'; // times of recent interest searches

type IqEntry = { t: number; v: Video[] };
const iqKey = (q: string) => IQ + q.trim().toLowerCase();
function readIq(q: string): IqEntry | null {
  try {
    return JSON.parse(localStorage.getItem(iqKey(q)) || 'null');
  } catch {
    return null;
  }
}

/** Which interests to search now: the budget left in this half day, never-searched first, then the oldest. */
export function interestsToSearch(interests: string[], now = Date.now()): string[] {
  let log: number[] = [];
  try {
    log = JSON.parse(localStorage.getItem(IQ_LOG) || '[]');
  } catch {
    /* ignore */
  }
  const budget = INTEREST_SEARCHES_PER_SLOT - log.filter((t) => now - t < INTEREST_SLOT_MS).length;
  if (budget <= 0) return [];
  return [...new Set(interests.map((q) => q.trim()).filter(Boolean))]
    .map((q) => ({ q, t: readIq(q)?.t ?? 0 }))
    .filter((x) => now - x.t >= INTEREST_SLOT_MS)
    .sort((a, b) => a.t - b.t)
    .slice(0, budget)
    .map((x) => x.q);
}

async function interestVideos(interests: string[]): Promise<Video[]> {
  const now = Date.now();
  const due = interestsToSearch(interests, now);
  if (due.length) {
    try {
      const log: number[] = JSON.parse(localStorage.getItem(IQ_LOG) || '[]').filter((t: number) => now - t < INTEREST_SLOT_MS);
      localStorage.setItem(IQ_LOG, JSON.stringify([...log, ...due.map(() => now)]));
    } catch {
      /* ignore */
    }
    await Promise.all(
      due.map((q) =>
        search(q)
          .then((p) => {
            // Descriptions aren't needed in the feed: leave them out to keep storage small.
            const v = p.items.slice(0, 20).map((x) => ({ ...x, description: '' }));
            try {
              localStorage.setItem(iqKey(q), JSON.stringify({ t: now, v }));
            } catch {
              /* storage full: ignore */
            }
          })
          .catch(() => {}),
      ),
    );
  }
  // Results of every current interest that are less than a week old; forget removed interests.
  const wanted = new Set(interests.map(iqKey));
  const out: Video[] = [];
  for (const k of Object.keys(localStorage).filter((k) => k.startsWith(IQ))) {
    const e = (() => {
      try {
        return JSON.parse(localStorage.getItem(k) || 'null') as IqEntry | null;
      } catch {
        return null;
      }
    })();
    if (!wanted.has(k) || !e || now - e.t > INTEREST_KEEP_MS) {
      localStorage.removeItem(k);
      continue;
    }
    out.push(...e.v);
  }
  return out;
}

/** Videos from ChatGPT's preferences: favourite channels' uploads and interest searches. */
async function preferenceVideos(): Promise<{ fromChannels: Video[]; fromInterests: Video[]; favIds: string[] }> {
  const r = loadRemotePrefs();
  const favIds = (
    await Promise.all(r.favoriteChannels.slice(0, 30).map((c) => resolveChannelId(c).catch(() => undefined)))
  ).filter(Boolean) as string[];
  const [fromChannels, fromInterests] = await Promise.all([
    favIds.length
      ? cached(`fy.fav.${favIds.join(',')}`, 60 * 60_000, () => channelsUploads(favIds, 6)).catch(() => [] as Video[])
      : Promise.resolve([] as Video[]),
    interestVideos(r.interests),
  ]);
  return { fromChannels, fromInterests, favIds };
}

/** In For you, after every MINE_PER_GPT of your videos comes one from ChatGPT (a pick, a favourite channel or an interest). */
export const MINE_PER_GPT = 2;

/** Your videos and ChatGPT's woven together: mine, mine, gpt, mine, mine, gpt… (leftovers at the end). */
export function weave(mine: Video[], gpt: Video[], minePerGpt = MINE_PER_GPT): Video[] {
  const out: Video[] = [];
  let m = 0;
  let g = 0;
  while (m < mine.length || g < gpt.length) {
    for (let k = 0; k < minePerGpt && m < mine.length; k++) out.push(mine[m++]);
    if (g < gpt.length) out.push(gpt[g++]);
  }
  return out;
}

export async function getForYou(): Promise<Video[]> {
  const agent = import('./agent');
  // Live and upcoming streams from channels/topics ChatGPT asked to watch get no special place:
  // they are candidates like any other video and compete on the same score.
  const streams = agent
    .then((m) => m.getLiveNow())
    .then((s) => [...s.live, ...s.soon])
    .catch(() => [] as Video[]);
  const [feed, picks] = await Promise.all([
    getLearnedFeed(streams),
    agent.then((m) => m.getPickVideos()).catch(() => [] as Video[]),
  ]);
  // ChatGPT's share: its hand-picked videos alternating with its favourite channels / interests.
  // Videos you've scrolled past many times drift a few places down (gently, never hidden).
  const gpt = demoteIgnored(weave(applyFilters(picks), feed.gpt, 1));
  const merged = weave(demoteIgnored(feed.mine), gpt);
  // Videos you started but haven't finished come back for a few days, a little way down, never at the top.
  const cont = await continueVideos();
  CONTINUE_SLOTS.forEach((slot, i) => cont[i] && merged.splice(Math.min(slot, merged.length), 0, cont[i]));
  const out: Video[] = [];
  const ids = new Set<string>();
  for (const v of merged) if (!ids.has(v.id)) ids.add(v.id), out.push(v);
  return out;
}

/** Where unfinished videos go in For you: 4th, 10th and 18th. */
export const CONTINUE_SLOTS = [3, 9, 17];

async function continueVideos(): Promise<Video[]> {
  const list = continueWatching().slice(0, CONTINUE_SLOTS.length);
  if (!list.length) return [];
  const vids = await getVideos(list.map((w) => w.id)).catch(() => [] as Video[]);
  return applyFilters(vids);
}

async function getLearnedFeed(extra: Promise<Video[]>): Promise<Streams> {
  const profile = buildProfile();
  if (profile.watches < 3) return getStarterFeed(extra);

  const topChannels = profile.channels.slice(0, 10);
  const queries = [...new Set(profile.seeds.slice(0, 3).map((w) => seedQuery(w, profile)).filter(Boolean))];

  const prefs = await preferenceVideos().catch(() => ({ fromChannels: [] as Video[], fromInterests: [] as Video[], favIds: [] as string[] }));
  const [fromChannels, fromSearch, fromSubs, fromLive] = await Promise.all([
    cached(`fy.ch.${topChannels.map((c) => c.id).join(',')}`, 60 * 60_000, () =>
      channelsUploads(topChannels.map((c) => c.id), 8),
    ).catch(() => [] as Video[]),
    Promise.all(
      queries.map((q) =>
        // Search costs 100 units, so each topic is searched at most twice a day.
        cached(`fy.q.${q}`, 12 * 3600_000, () => search(q).then((p) => p.items)).catch(() => [] as Video[]),
      ),
    ).then((r) => r.flat()),
    getSubscriptionFeed().catch(() => [] as Video[]),
    extra,
  ]);

  // Score every candidate against your taste profile.
  const seen = seenIds();
  const maxCh = topChannels[0]?.score || 1;
  const chScore = new Map(profile.channels.map((c) => [c.id, c.score / maxCh]));
  const termTop = profile.terms.slice(0, 60);
  const maxT = termTop[0]?.score || 1;
  const termScore = new Map(termTop.map((t) => [t.term, t.score / maxT]));
  // ChatGPT's interests count like your strongest topics; favourite channels like your top channel.
  for (const interest of loadRemotePrefs().interests) for (const w of tokens(interest)) termScore.set(w, Math.max(termScore.get(w) || 0, 1));
  for (const id of prefs.favIds) chScore.set(id, Math.max(chScore.get(id) || 0, 1));
  const subIds = new Set(fromSubs.map((v) => v.channelId));
  // Topics you keep turning away from pull a video down (a word can't cost more than 1).
  const avoidScore = new Map(profile.avoid.map((t) => [t.term, Math.min(1, -t.score * 2)]));
  const typical = channelAudience([...fromChannels, ...fromSearch, ...fromSubs, ...prefs.fromChannels, ...prefs.fromInterests, ...fromLive]);
  const now = Date.now();

  const scored = new Map<string, { v: Video; s: number; gpt: boolean }>();
  const add = (list: Video[], bonus: number, gpt = false) => {
    for (const v of applyFilters(list)) {
      if (seen.has(v.id) || scored.has(v.id)) continue;
      const ageDays = (Date.now() - new Date(v.publishedAt).getTime()) / 86400_000;
      const words = new Set([...tokens(v.title), ...(v.tags || []).flatMap(tokens)]);
      let topic = 0;
      let avoid = 0;
      words.forEach((w) => {
        topic += termScore.get(w) || 0;
        avoid += avoidScore.get(w) || 0;
      });
      const s =
        2 * Math.max(0, chScore.get(v.channelId) || 0) +
        Math.min(2, topic) -
        Math.min(1.5, avoid) +
        1.2 / (1 + Math.max(0, ageDays) / 7) +
        (subIds.has(v.channelId) ? 0.3 : 0) +
        audienceScore(v, typical.get(v.channelId), now) +
        bonus +
        Math.random() * 0.4;
      scored.set(v.id, { v, s, gpt });
    }
  };
  // Your own sources first, so a video from a channel you watch counts as yours even if ChatGPT also likes it.
  add(fromChannels, 0.3);
  add(fromSearch, 0.2);
  add(fromSubs, 0);
  add(prefs.fromChannels, 0.3, true);
  add(prefs.fromInterests, 0.2, true);
  add(fromLive, 0, true); // streams from channels/topics ChatGPT watches (yours are already in fromSubs)

  const all = [...scored.values()];
  return { mine: diverse(all.filter((c) => !c.gpt)), gpt: diverse(all.filter((c) => c.gpt)) };
}

// ── How big an audience a video has, compared with its channel's usual audience ──
// A channel's typical audience is the median views of its uploads in the candidate list that are
// at least a couple of days old (no extra API calls). Needs a few of them; otherwise no opinion.
const AUDIENCE_MIN_SAMPLES = 3;
const SETTLED_DAYS = 2;

const ageDaysOf = (v: Video, now: number) => (now - new Date(v.publishedAt).getTime()) / 86400_000;

/** Median views per channel, from its settled uploads in the list. */
export function channelAudience(videos: Video[], now = Date.now()): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const v of videos) {
    if (v.live || v.upcoming || !(v.views > 0) || !(ageDaysOf(v, now) >= SETTLED_DAYS)) continue;
    const list = by.get(v.channelId) || [];
    list.push(v.views);
    by.set(v.channelId, list);
  }
  const out = new Map<string, number>();
  for (const [ch, list] of by) {
    if (list.length < AUDIENCE_MIN_SAMPLES) continue;
    list.sort((a, b) => a - b);
    out.set(ch, list[Math.floor(list.length / 2)]);
  }
  return out;
}

/**
 * Score adjustment for audience size (about −3 … +0.5). Few people care about this video compared with
 * what the channel normally gets, e.g. a practice-court camera with 41 viewers on a channel whose videos
 * get 50K views: strongly down. An upload doing much better than usual: slightly up.
 */
export function audienceScore(v: Video, typical: number | undefined, now = Date.now()): number {
  if (!typical || v.upcoming) return 0;
  if (v.live) {
    // A stream people care about has at least ~1% of the channel's usual audience watching at once.
    if (!v.liveViewers) return 0; // count hidden by the channel
    const ratio = v.liveViewers / typical;
    return ratio >= 0.01 ? 0 : -Math.min(3, Math.log10(0.01 / ratio) * 2);
  }
  const age = ageDaysOf(v, now);
  if (!(age >= 0.5)) return 0; // too new to judge
  const expected = typical * Math.min(1, age / 3); // most views come in the first few days
  const ratio = (v.views || 0) / expected;
  if (ratio < 0.25) return -Math.min(2, Math.log10(0.25 / Math.max(ratio, 1e-4)) * 1.5);
  if (ratio > 2) return Math.min(0.5, Math.log10(ratio / 2) * 0.5);
  return 0;
}

/** Best first, but don't let one channel take over the screen. */
function diverse(pool: { v: Video; s: number }[]): Video[] {
  const pool2 = [...pool];
  const perChannel = new Map<string, number>();
  const out: Video[] = [];
  while (pool2.length && out.length < 120) {
    let bi = 0;
    let best = -Infinity;
    pool2.forEach((c, i) => {
      const adj = c.s - 0.7 * (perChannel.get(c.v.channelId) || 0);
      if (adj > best) {
        best = adj;
        bi = i;
      }
    });
    const [pick] = pool2.splice(bi, 1);
    perChannel.set(pick.v.channelId, (perChannel.get(pick.v.channelId) || 0) + 1);
    out.push(pick.v);
  }
  return out;
}

/** Resolves a channel given as UC… id, @handle or YouTube URL. Cached for a week. */
export async function resolveChannelId(input: string): Promise<string | undefined> {
  const s = input.trim();
  const id = s.match(/(UC[A-Za-z0-9_-]{22})/)?.[1];
  if (id) return id;
  const handle = s.match(/@([A-Za-z0-9._-]+)/)?.[1] || (/^[A-Za-z0-9._-]+$/.test(s) ? s : undefined);
  if (!handle) return undefined;
  return cached(`handle.${handle.toLowerCase()}`, 7 * 86400_000, async () => {
    const data = await yt('channels', { part: 'id', forHandle: `@${handle}` });
    return data.items?.[0]?.id as string | undefined;
  });
}

// ── subscriptions management ───────────────────────────────

/** All your subscriptions (up to 1000), for the Subscriptions page. Fresh from YouTube each time. */
export async function listAllSubscriptions(): Promise<Channel[]> {
  const out: Channel[] = [];
  let pageToken: string | undefined;
  do {
    const data = await yt('subscriptions', { part: 'snippet', mine: true, order: 'relevance', maxResults: 50, pageToken });
    for (const s of data.items || [])
      out.push({
        subId: s.id,
        id: s.snippet.resourceId.channelId,
        title: s.snippet.title,
        thumb: bestThumb(s.snippet.thumbnails),
      });
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < 1000);
  return out;
}

/** Find channels by name (100 units), with subscriber counts. */
export async function searchChannels(q: string): Promise<Channel[]> {
  const data = await yt('search', { part: 'snippet', type: 'channel', q, maxResults: 12 });
  const ids: string[] = (data.items || []).map((i: any) => i.id?.channelId || i.snippet?.channelId).filter(Boolean);
  if (!ids.length) return [];
  const det = await yt('channels', { part: 'snippet,statistics', id: ids.join(',') });
  const map = new Map<string, Channel>(
    (det.items || []).map((c: any) => [
      c.id,
      {
        id: c.id,
        title: c.snippet.title,
        thumb: bestThumb(c.snippet.thumbnails),
        subscribers: Number(c.statistics?.subscriberCount || 0),
        videoCount: Number(c.statistics?.videoCount || 0),
      },
    ]),
  );
  return ids.map((id) => map.get(id)).filter(Boolean) as Channel[];
}

/** A channel's most viewed videos (search ordered by views; 100 units per page, cached 6h). */
export async function getChannelPopular(channelId: string, pageToken?: string): Promise<Page<Video>> {
  return cached(`popular.${channelId}.${pageToken || ''}`, 6 * 3600_000, async () => {
    const data = await yt('search', { part: 'snippet', type: 'video', channelId, order: 'viewCount', maxResults: 24, pageToken });
    const ids = (data.items || []).map((i: any) => i.id?.videoId);
    return { items: applyFilters(await getVideos(ids)), next: data.nextPageToken as string | undefined };
  });
}
