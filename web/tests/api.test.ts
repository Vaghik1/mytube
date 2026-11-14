import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFilters,
  chunk,
  getForYou,
  getPopular,
  getVideos,
  parseDuration,
  resolveChannelId,
  search,
  toVideo,
  type Video,
} from '../src/api';
import { saveRemotePrefs, saveSettings, defaultSettings } from '../src/config';
import { recordWatch } from '../src/history';
import { calls, mockYouTube, signIn, ytVideo } from './youtube-mock';

beforeEach(() => signIn());

const v = (over: Partial<Video>): Video => ({
  id: 'x',
  title: 'A video',
  channelId: 'c',
  channelTitle: 'C',
  publishedAt: new Date().toISOString(),
  thumb: '',
  duration: 600,
  views: 0,
  likes: 0,
  live: false,
  description: '',
  ...over,
});

describe('parseDuration', () => {
  it.each([
    ['PT45S', 45],
    ['PT4M31S', 271],
    ['PT1H2M5S', 3725],
    ['P1DT1H', 90000],
    ['P0D', 0],
    [undefined, 0],
  ])('%s → %i', (iso, sec) => expect(parseDuration(iso)).toBe(sec));
});

describe('toVideo', () => {
  it('maps YouTube data into the app format', () => {
    const out = toVideo(ytVideo({ id: 'abc', channelId: 'ch', title: 'Hello', duration: 'PT2M' }));
    expect(out).toMatchObject({ id: 'abc', title: 'Hello', channelId: 'ch', duration: 120, views: 1000, likes: 10, live: false });
    expect(out.thumb).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
  });
  it('recognises live and upcoming streams', () => {
    expect(toVideo(ytVideo({ id: 'l', channelId: 'c', live: 'live' })).live).toBe(true);
    const up = toVideo(ytVideo({ id: 'u', channelId: 'c', live: 'upcoming', scheduledStart: '2026-11-14T14:00:00Z' }));
    expect(up.live).toBe(false);
    expect(up.upcoming).toBe(true);
    expect(up.scheduledStart).toBe('2026-11-14T14:00:00Z');
  });
  it('accepts search results whose id is an object', () => {
    expect(toVideo({ id: { videoId: 'zz' }, snippet: {} }).id).toBe('zz');
  });
});

describe('applyFilters (your personal rules)', () => {
  it('hides Shorts only when the setting is on, never live streams', () => {
    const list = [v({ id: 's', duration: 50 }), v({ id: 'long', duration: 900 }), v({ id: 'live', duration: 0, live: true })];
    expect(applyFilters(list).map((x) => x.id)).toEqual(['s', 'long', 'live']);
    saveSettings({ ...defaultSettings, hideShorts: true });
    expect(applyFilters(list).map((x) => x.id)).toEqual(['long', 'live']);
  });
  it('removes blocked channels by id or name, case-insensitive', () => {
    saveSettings({ ...defaultSettings, blockedChannels: ['UCbad', 'Annoying Channel'] });
    const list = [v({ id: '1', channelId: 'UCBAD' }), v({ id: '2', channelTitle: 'annoying channel' }), v({ id: '3' })];
    expect(applyFilters(list).map((x) => x.id)).toEqual(['3']);
  });
  it('removes videos whose title has a blocked word', () => {
    saveSettings({ ...defaultSettings, blockedKeywords: ['prank'] });
    expect(applyFilters([v({ id: '1', title: 'Epic PRANK gone wrong' }), v({ id: '2' })]).map((x) => x.id)).toEqual(['2']);
  });
  it('drops private and deleted videos', () => {
    expect(applyFilters([v({ id: '1', title: 'Private video' }), v({ id: '2', title: 'Deleted video' }), v({ id: '' })])).toEqual([]);
  });
});

describe("applyFilters with ChatGPT's preferences", () => {
  it('hides disliked topics when all their words appear in title or tags', () => {
    saveRemotePrefs({ dislikedTopics: ['celebrity gossip'] });
    const list = [
      v({ id: '1', title: 'Celebrity gossip of the week' }),
      v({ id: '2', title: 'Weekly news', tags: ['celebrity', 'gossip'] }),
      v({ id: '3', title: 'Celebrity chess match' }), // only one word: stays
    ];
    expect(applyFilters(list).map((x) => x.id)).toEqual(['3']);
  });

  it("merges ChatGPT's blocked channels and words with yours", () => {
    saveSettings({ ...defaultSettings, blockedKeywords: ['prank'] });
    saveRemotePrefs({ blockedChannels: ['Drama Channel'], blockedWords: ['reaction'] });
    const list = [v({ id: '1', title: 'PRANK' }), v({ id: '2', title: 'My reaction' }), v({ id: '3', channelTitle: 'drama channel' }), v({ id: '4' })];
    expect(applyFilters(list).map((x) => x.id)).toEqual(['4']);
  });

  it("ChatGPT's Shorts choice wins over yours, in both directions", () => {
    const list = [v({ id: 's', duration: 40 })];
    saveRemotePrefs({ hideShorts: true });
    expect(applyFilters(list)).toEqual([]);
    saveSettings({ ...defaultSettings, hideShorts: true });
    saveRemotePrefs({ hideShorts: false });
    expect(applyFilters(list)).toHaveLength(1);
    saveRemotePrefs({});
    expect(applyFilters(list)).toEqual([]); // back to your own setting
  });
});

describe('chunk', () => {
  it('splits into groups', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
});

describe('getVideos', () => {
  it('asks YouTube in batches of 50 and keeps your order', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const f = mockYouTube({
      videos: (p) => ({ items: p.get('id')!.split(',').reverse().map((id) => ytVideo({ id, channelId: 'c' })) }),
    });
    const out = await getVideos([...ids, 'v0']); // duplicate is dropped
    expect(out.map((x) => x.id)).toEqual(ids);
    expect(calls(f, 'videos')).toHaveLength(3);
    expect(calls(f, 'videos').every((u) => u.searchParams.get('id')!.split(',').length <= 50)).toBe(true);
  });
  it('sends the signed-in token', async () => {
    const f = mockYouTube({ videos: () => ({ items: [] }) });
    await getVideos(['a']);
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
  });
  it('reports the daily quota error clearly', async () => {
    mockYouTube({
      videos: () =>
        new Response(JSON.stringify({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }),
    });
    await expect(getVideos(['a'])).rejects.toMatchObject({ reason: 'quotaExceeded', status: 403 });
  });
});

describe('getPopular (Trending tab)', () => {
  it('uses the chosen region and falls back to US when it is empty', async () => {
    saveSettings({ ...defaultSettings, region: 'AM' });
    const f = mockYouTube({
      videos: (p) => ({ items: p.get('regionCode') === 'US' ? [ytVideo({ id: 'us1', channelId: 'c' })] : [] }),
    });
    const page = await getPopular();
    expect(page.items.map((x) => x.id)).toEqual(['us1']);
    expect(calls(f, 'videos').map((u) => u.searchParams.get('regionCode'))).toEqual(['AM', 'US']);
  });
});

describe('search', () => {
  it('returns full video details for search hits', async () => {
    mockYouTube({
      search: () => ({ items: [{ id: { videoId: 's1' } }, { id: { videoId: 's2' } }], nextPageToken: 'n' }),
      videos: (p) => ({ items: p.get('id')!.split(',').map((id) => ytVideo({ id, channelId: 'c', duration: 'PT3M' })) }),
    });
    const r = await search('chess');
    expect(r.items.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(r.items[0].duration).toBe(180);
    expect(r.next).toBe('n');
  });
});

describe('resolveChannelId', () => {
  it('accepts channel ids and URLs without calling YouTube', async () => {
    const f = mockYouTube({});
    const id = 'UC' + 'a'.repeat(22);
    expect(await resolveChannelId(id)).toBe(id);
    expect(await resolveChannelId(`https://www.youtube.com/channel/${id}`)).toBe(id);
    expect(f).not.toHaveBeenCalled();
  });
  it('looks up @handles once and caches them', async () => {
    const f = mockYouTube({ channels: (p) => ({ items: p.get('forHandle') === '@chess' ? [{ id: 'UCchess' }] : [] }) });
    expect(await resolveChannelId('https://www.youtube.com/@chess')).toBe('UCchess');
    expect(await resolveChannelId('@chess')).toBe('UCchess');
    expect(calls(f, 'channels')).toHaveLength(1);
  });
});

describe('For you', () => {
  // Subscriptions feed: subscriptions → channels (uploads playlist) → playlistItems → videos.
  const subsRoutes = (subChannels: string[], uploadsPerChannel: Record<string, string[]>) => ({
    subscriptions: () => ({
      items: subChannels.map((c) => ({ snippet: { resourceId: { channelId: c }, title: c, thumbnails: {} } })),
    }),
    channels: (p: URLSearchParams) => ({
      items: p
        .get('id')!
        .split(',')
        .map((id) => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })),
    }),
    playlistItems: (p: URLSearchParams) => ({
      items: (uploadsPerChannel[p.get('playlistId')!.replace('UU-', '')] || []).map((vid, i) => ({
        contentDetails: { videoId: vid, videoPublishedAt: new Date(Date.now() - i * 3600_000).toISOString() },
      })),
    }),
    videos: (p: URLSearchParams) => {
      if (p.get('myRating') === 'like') return { items: [] };
      return {
        items: p
          .get('id')!
          .split(',')
          .map((id) => ytVideo({ id, channelId: id.split('-')[0], title: `${id} chess lesson` })),
      };
    },
    search: () => ({ items: [] }),
  });

  it('starts with your subscriptions and never uses regional charts', async () => {
    const f = mockYouTube(subsRoutes(['a'], { a: ['a-1', 'a-2'] }), { '/api/picks': () => ({ picks: [] }) });
    const feed = await getForYou();
    expect(feed.map((x) => x.id)).toEqual(['a-1', 'a-2']);
    expect(calls(f, 'videos').some((u) => u.searchParams.get('chart') === 'mostPopular')).toBe(false);
  });

  it('learns from what you watch and skips videos you already saw', async () => {
    for (const id of ['a-old1', 'a-old2', 'a-old3'])
      recordWatch({ ...v({ id, channelId: 'a', title: 'chess lesson' }), duration: 600 }, 590);
    const f = mockYouTube(subsRoutes(['a', 'b'], { a: ['a-1', 'a-old1', 'a-2'], b: ['b-1'] }), {
      '/api/picks': () => ({ picks: [] }),
    });
    const ids = (await getForYou()).map((x) => x.id);
    expect(ids).not.toContain('a-old1');
    expect(ids).toEqual(expect.arrayContaining(['a-1', 'a-2', 'b-1']));
    expect(ids[0].startsWith('a-')).toBe(true); // your favourite channel ranks first
    expect(calls(f, 'videos').some((u) => u.searchParams.get('chart') === 'mostPopular')).toBe(false);
  });

  it("puts ChatGPT's picks first, with their reason", async () => {
    mockYouTube(subsRoutes(['a'], { a: ['a-1'] }), {
      '/api/picks': () => ({ picks: [{ id: 'p', type: 'video', videoId: 'gpt-1', reason: 'Great endgame', status: 'new' }] }),
    });
    const feed = await getForYou();
    expect(feed[0].id).toBe('gpt-1');
    expect(feed[0].note).toBe('Great endgame');
  });

  it('puts live streams from your subscriptions first, then ChatGPT picks', async () => {
    const routes = subsRoutes(['a'], { a: ['a-1', 'a-live'] });
    const videos = routes.videos;
    routes.videos = (p: URLSearchParams) => {
      const r = videos(p) as { items: ReturnType<typeof ytVideo>[] };
      return { items: r.items.map((it) => (it.id === 'a-live' ? ytVideo({ id: 'a-live', channelId: 'a', live: 'live', duration: 'P0D' }) : it)) };
    };
    mockYouTube(routes, {
      '/api/picks': () => ({ picks: [{ id: 'p', type: 'video', videoId: 'gpt-1', reason: 'r', status: 'new' }] }),
    });
    const ids = (await getForYou()).map((x) => x.id);
    expect(ids.slice(0, 2)).toEqual(['a-live', 'gpt-1']);
    expect(ids.filter((id) => id === 'a-live')).toHaveLength(1); // not repeated further down
  });

  it("adds favourite channels' uploads and interest searches from ChatGPT", async () => {
    saveRemotePrefs({ favoriteChannels: ['UC' + 'f'.repeat(22)], interests: ['physics'] });
    const routes = subsRoutes(['a'], { a: ['a-1'], ['UC' + 'f'.repeat(22)]: ['fav-1'] });
    routes.search = (p: URLSearchParams) => ({ items: p.get('q') === 'physics' ? [{ id: { videoId: 'phys-1' } }] : [] });
    const f = mockYouTube(routes, { '/api/picks': () => ({ picks: [] }) });
    const ids = (await getForYou()).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['a-1', 'fav-1', 'phys-1']));
    // searched once, then cached
    await getForYou();
    expect(calls(f, 'search').filter((u) => u.searchParams.get('q') === 'physics')).toHaveLength(1);
  });

  it('searches at most 3 interests (YouTube quota)', async () => {
    saveRemotePrefs({ interests: ['a1', 'b2', 'c3', 'd4', 'e5'] });
    const f = mockYouTube(subsRoutes([], {}), { '/api/picks': () => ({ picks: [] }) });
    await getForYou();
    expect(calls(f, 'search').map((u) => u.searchParams.get('q')).sort()).toEqual(['c3', 'd4', 'e5']);
  });

  it('still works when the assistant hub is down', async () => {
    mockYouTube(subsRoutes(['a'], { a: ['a-1'] }), { '/api/picks': () => new Response('{}', { status: 500 }) });
    expect((await getForYou()).map((x) => x.id)).toEqual(['a-1']);
  });
});
