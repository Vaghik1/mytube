import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFilters,
  clearCache,
  INTEREST_KEEP_MS,
  INTEREST_SEARCHES_PER_SLOT,
  INTEREST_SLOT_MS,
  interestsToSearch,
  chunk,
  getForYou,
  getPopular,
  getVideos,
  parseDuration,
  resolveChannelId,
  search,
  toVideo,
  weave,
  CONTINUE_SLOTS,
  audienceScore,
  channelAudience,
  channelLoyalty,
  diverse,
  freshness,
  type Video,
} from '../src/api';
import { saveRemotePrefs, saveSettings, defaultSettings } from '../src/config';
import { notInterested, recordWatch } from '../src/history';
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

  it("merges ChatGPT's picks with your subscriptions: two of yours, then one of ChatGPT's", async () => {
    mockYouTube(subsRoutes(['a'], { a: ['a-1', 'a-2', 'a-3', 'a-4'] }), {
      '/api/picks': () => ({
        picks: [
          { id: 'p', type: 'video', videoId: 'gpt-1', reason: 'Great endgame', status: 'new' },
          { id: 'q', type: 'video', videoId: 'gpt-2', reason: 'r', status: 'new' },
        ],
      }),
    });
    const feed = await getForYou();
    expect(feed.map((v) => v.id)).toEqual(['a-1', 'a-2', 'gpt-1', 'a-3', 'a-4', 'gpt-2']);
    expect(feed[2].note).toBe('Great endgame');
  });

  it('gives live streams no special place: they are merged like any other video', async () => {
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
    expect(ids).toEqual(['a-1', 'a-live', 'gpt-1']);
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

  const nine = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'];

  it('searches only a few interests per half day (YouTube search allowance)', async () => {
    saveRemotePrefs({ interests: nine });
    const f = mockYouTube(subsRoutes([], {}), { '/api/picks': () => ({ picks: [] }) });
    await getForYou();
    expect(calls(f, 'search')).toHaveLength(INTEREST_SEARCHES_PER_SLOT);
    clearCache('fy.'); // even when the feed is rebuilt, no more searches until the next half day
    await getForYou();
    expect(calls(f, 'search')).toHaveLength(INTEREST_SEARCHES_PER_SLOT);
  });

  it('takes turns: never-searched interests first, then the oldest; all results stay in the feed for a week', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-11-14T08:00:00Z').getTime();
    vi.setSystemTime(t0);
    signIn();
    saveRemotePrefs({ interests: nine });
    const routes = subsRoutes([], {});
    routes.search = (p: URLSearchParams) => ({ items: [{ id: { videoId: `${p.get('q')}-vid` } }] });
    const f = mockYouTube(routes, { '/api/picks': () => ({ picks: [] }) });
    const searched = () => calls(f, 'search').map((u) => u.searchParams.get('q'));

    await getForYou();
    const first = searched();
    expect(first).toHaveLength(INTEREST_SEARCHES_PER_SLOT);

    vi.setSystemTime(t0 + INTEREST_SLOT_MS + 1000);
    signIn(); // the test sign-in lasts an hour
    clearCache('fy.');
    const ids = (await getForYou()).map((x) => x.id);
    const second = searched().slice(first.length);
    expect(second).toHaveLength(INTEREST_SEARCHES_PER_SLOT);
    // the never-searched ones come first
    expect(second).toEqual(expect.arrayContaining(nine.filter((q) => !first.includes(q))));
    // videos from all nine interests are in the feed now
    expect(ids).toEqual(expect.arrayContaining(nine.map((q) => `${q}-vid`)));
    expect(interestsToSearch(nine)).toEqual([]); // allowance used up

    // removed interests are forgotten; results older than a week are dropped
    saveRemotePrefs({ interests: ['q1'] });
    vi.setSystemTime(t0 + INTEREST_KEEP_MS + INTEREST_SLOT_MS + 2000);
    signIn();
    clearCache('fy.');
    const later = (await getForYou()).map((x) => x.id);
    expect(later).not.toContain('q2-vid');
    vi.useRealTimers();
  });

  it("never starts with a block of ChatGPT videos, and drops none of them", async () => {
    const routes = subsRoutes(['a'], { a: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'] });
    const picks = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id) => ({ id: `gpt-${id}`, type: 'video', videoId: `gpt-${id}`, status: 'new' }));
    mockYouTube(routes, { '/api/picks': () => ({ picks }) });
    const ids = (await getForYou()).map((x) => x.id);
    const isGpt = (id: string) => id.startsWith('gpt-');
    expect(ids.slice(0, 9).filter(isGpt)).toHaveLength(3); // a third of the first screen
    for (let i = 1; i < 9; i++) expect(isGpt(ids[i]) && isGpt(ids[i - 1])).toBe(false); // never two in a row while yours last
    expect(ids.filter(isGpt)).toHaveLength(7); // the rest come after your videos run out
  });

  it('weave: two of yours, one of ChatGPT, leftovers at the end', () => {
    const vs = (...ids: string[]) => ids.map((id) => ({ id }) as Video);
    expect(weave(vs('m1', 'm2', 'm3', 'm4', 'm5'), vs('g1', 'g2')).map((v) => v.id)).toEqual(['m1', 'm2', 'g1', 'm3', 'm4', 'g2', 'm5']);
    expect(weave(vs('m1'), vs('g1', 'g2', 'g3')).map((v) => v.id)).toEqual(['m1', 'g1', 'g2', 'g3']);
  });

  it('brings back a video you started but did not finish, a little way down (never at the top)', async () => {
    recordWatch({ ...ytVideoToVideo('half-1'), duration: 1800 }, 600, 600);
    mockYouTube(subsRoutes(['a'], { a: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'] }), { '/api/picks': () => ({ picks: [] }) });
    const ids = (await getForYou()).map((x) => x.id);
    expect(ids.indexOf('half-1')).toBe(CONTINUE_SLOTS[0]);
    expect(ids.filter((id) => id === 'half-1')).toHaveLength(1);
  });

  it('still works when the assistant hub is down', async () => {
    mockYouTube(subsRoutes(['a'], { a: ['a-1'] }), { '/api/picks': () => new Response('{}', { status: 500 }) });
    expect((await getForYou()).map((x) => x.id)).toEqual(['a-1']);
  });
});

function ytVideoToVideo(id: string): Video {
  return toVideo(ytVideo({ id, channelId: 'z', title: `${id} chess lesson` }));
}

describe('audience size compared with the channel', () => {
  const NOW = new Date('2026-11-17T12:00:00Z').getTime();
  const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();
  const uploads = [30_000, 50_000, 70_000].map((views, i) => v({ id: `u${i}`, channelId: 'atp', views, publishedAt: daysAgo(5 + i) }));

  it("works out a channel's usual audience from its settled uploads (median)", () => {
    expect(channelAudience(uploads, NOW).get('atp')).toBe(50_000);
  });

  it('has no opinion with too few uploads, or only brand-new ones', () => {
    expect(channelAudience(uploads.slice(0, 2), NOW).has('atp')).toBe(false);
    const fresh = uploads.map((u) => ({ ...u, publishedAt: daysAgo(0.5) }));
    expect(channelAudience(fresh, NOW).has('atp')).toBe(false);
  });

  it('a live stream almost nobody watches (practice camera) goes well down; a big one is fine', () => {
    const practice = v({ live: true, liveViewers: 41, duration: 0, publishedAt: daysAgo(0) });
    expect(audienceScore(practice, 50_000, NOW)).toBeLessThan(-1.5);
    const match = v({ live: true, liveViewers: 8_000, duration: 0, publishedAt: daysAgo(0) });
    expect(audienceScore(match, 50_000, NOW)).toBe(0);
    expect(audienceScore({ ...practice, liveViewers: undefined }, 50_000, NOW)).toBe(0); // hidden count
  });

  it('an upload far below what the channel usually gets for its age goes down; a hit goes slightly up', () => {
    expect(audienceScore(v({ views: 1_000, publishedAt: daysAgo(5) }), 50_000, NOW)).toBeLessThan(-1);
    expect(audienceScore(v({ views: 40_000, publishedAt: daysAgo(5) }), 50_000, NOW)).toBe(0);
    expect(audienceScore(v({ views: 400_000, publishedAt: daysAgo(5) }), 50_000, NOW)).toBeGreaterThan(0);
    // a few hours old: too early to judge
    expect(audienceScore(v({ views: 10, publishedAt: daysAgo(0.2) }), 50_000, NOW)).toBe(0);
    // one day old with a third of the usual views: on track
    expect(audienceScore(v({ views: 15_000, publishedAt: daysAgo(1) }), 50_000, NOW)).toBe(0);
  });

  it('in For you, a practice stream from a channel you watch a lot no longer leads', async () => {
    // You watch ATP Tour a lot (3 full matches).
    for (const id of ['atp-old1', 'atp-old2', 'atp-old3'])
      recordWatch({ ...v({ id, channelId: 'atp', title: 'ATP Finals tennis highlights' }), duration: 600 }, 590);
    const pub = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
    const vids: Record<string, Parameters<typeof ytVideo>[0]> = {
      'atp-live': { id: 'atp-live', channelId: 'atp', title: 'ATP Finals Live Practice Stream', live: 'live', duration: 'P0D', liveViewers: 41, publishedAt: pub(0) },
      'atp-1': { id: 'atp-1', channelId: 'atp', title: 'ATP Finals tennis highlights day 1', views: 60_000, publishedAt: pub(3) },
      'atp-2': { id: 'atp-2', channelId: 'atp', title: 'ATP Finals tennis highlights day 2', views: 50_000, publishedAt: pub(4) },
      'atp-3': { id: 'atp-3', channelId: 'atp', title: 'ATP Finals tennis highlights day 3', views: 40_000, publishedAt: pub(5) },
    };
    mockYouTube(
      {
        subscriptions: () => ({ items: [{ snippet: { resourceId: { channelId: 'atp' }, title: 'ATP', thumbnails: {} } }] }),
        channels: (p: URLSearchParams) => ({ items: p.get('id')!.split(',').map((id) => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })) }),
        playlistItems: () => ({ items: Object.keys(vids).map((id) => ({ contentDetails: { videoId: id } })) }),
        videos: (p: URLSearchParams) => (p.get('myRating') ? { items: [] } : { items: p.get('id')!.split(',').filter((id) => vids[id]).map((id) => ytVideo(vids[id])) }),
        search: () => ({ items: [] }),
      },
      { '/api/picks': () => ({ picks: [] }) },
    );
    for (let i = 0; i < 5; i++) {
      clearCache('fy.');
      const ids = (await getForYou()).map((x) => x.id);
      expect(ids.indexOf('atp-live')).toBe(ids.length - 1); // last of the four, every time
    }
  });

  it('topics you keep leaving quickly, or mark "Not interested", pull similar videos down', async () => {
    for (const id of ['c-old1', 'c-old2', 'c-old3'])
      recordWatch({ ...v({ id, channelId: 'c', title: 'chess tournament round' }), duration: 600 }, 590);
    notInterested(v({ id: 'p1', channelId: 'c', title: 'chess practice warmup' }));
    notInterested(v({ id: 'p2', channelId: 'c', title: 'chess practice warmup again' }));
    // Same words you like in both; only the second has the topics you turned away from.
    const titles: Record<string, string> = { 'c-a': 'chess tournament round analysis', 'c-b': 'chess tournament round practice warmup' };
    mockYouTube(
      {
        subscriptions: () => ({ items: [{ snippet: { resourceId: { channelId: 'c' }, title: 'C', thumbnails: {} } }] }),
        channels: (p: URLSearchParams) => ({ items: p.get('id')!.split(',').map((id) => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })) }),
        playlistItems: () => ({ items: Object.keys(titles).map((id) => ({ contentDetails: { videoId: id } })) }),
        videos: (p: URLSearchParams) => (p.get('myRating') ? { items: [] } : { items: p.get('id')!.split(',').filter((id) => titles[id]).map((id) => ytVideo({ id, channelId: 'c', title: titles[id] })) }),
        search: () => ({ items: [] }),
      },
      { '/api/picks': () => ({ picks: [] }) },
    );
    for (let i = 0; i < 5; i++) {
      clearCache('fy.');
      expect((await getForYou()).map((x) => x.id)).toEqual(['c-a', 'c-b']);
    }
  });
});

describe('loyalty: channels whose new videos you always watch', () => {
  const NOW = new Date('2026-11-17T12:00:00Z').getTime();
  const at = (d: number) => new Date(NOW - d * 86400_000).toISOString();
  const watch = (id: string, ch: string, sec = 600) => ({ id, ch, cht: ch, title: 't', sec, dur: 600, at: NOW });

  it('is the share of the recent uploads you watched, smoothed', () => {
    const uploads = [1, 2, 3, 4].map((d) => v({ id: `f${d}`, channelId: 'fav', publishedAt: at(d * 7) }));
    const all = channelLoyalty(uploads, uploads.map((u) => watch(u.id, 'fav')), NOW);
    expect(all.get('fav')).toBeCloseTo(4 / 5);
    const half = channelLoyalty(uploads, [watch('f1', 'fav'), watch('f2', 'fav')], NOW);
    expect(half.get('fav')).toBeCloseTo(2 / 5);
  });

  it("doesn't count brand-new uploads (you haven't had a chance yet), quick peeks, or a single video", () => {
    const uploads = [v({ id: 'n', channelId: 'fav', publishedAt: at(0.2) }), v({ id: 'o1', channelId: 'fav', publishedAt: at(3) }), v({ id: 'o2', channelId: 'fav', publishedAt: at(5) })];
    expect(channelLoyalty(uploads, [watch('o1', 'fav', 10), watch('o2', 'fav', 10)], NOW).has('fav')).toBe(false);
    expect(channelLoyalty(uploads.slice(0, 2), [watch('o1', 'fav')], NOW).has('fav')).toBe(false);
  });

  it("a channel you watch faithfully leads with its new video, even over a channel you watch more of", async () => {
    const pub = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
    const vids: Record<string, Parameters<typeof ytVideo>[0]> = {};
    const add = (id: string, channelId: string, days: number) => (vids[id] = { id, channelId, title: 'chess lesson', publishedAt: pub(days) });
    // A weekly channel: you watched each of its last 4 videos.
    add('fav-new', 'fav', 0.1);
    for (const w of [1, 2, 3, 4]) add(`fav-${w}`, 'fav', w * 7);
    // A daily channel: you watched 8 of its older videos (more in total), but skip most new ones.
    add('big-new', 'big', 0.1);
    add('big-a', 'big', 2);
    add('big-b', 'big', 3);
    for (let i = 1; i <= 8; i++) recordWatch({ ...v({ id: `big-old${i}`, channelId: 'big', title: 'chess lesson' }), duration: 600 }, 590);
    for (const w of [1, 2, 3, 4]) recordWatch({ ...v({ id: `fav-${w}`, channelId: 'fav', title: 'chess lesson' }), duration: 600 }, 590);
    const uploads = (ch: string) => Object.keys(vids).filter((id) => vids[id].channelId === ch);
    mockYouTube(
      {
        subscriptions: () => ({ items: ['fav', 'big'].map((c) => ({ snippet: { resourceId: { channelId: c }, title: c, thumbnails: {} } })) }),
        channels: (p: URLSearchParams) => ({ items: p.get('id')!.split(',').map((id) => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })) }),
        playlistItems: (p: URLSearchParams) => ({ items: uploads(p.get('playlistId')!.replace('UU-', '')).map((id) => ({ contentDetails: { videoId: id, videoPublishedAt: vids[id].publishedAt } })) }),
        videos: (p: URLSearchParams) => (p.get('myRating') ? { items: [] } : { items: p.get('id')!.split(',').filter((id) => vids[id]).map((id) => ytVideo(vids[id])) }),
        search: () => ({ items: [] }),
      },
      { '/api/picks': () => ({ picks: [] }) },
    );
    for (let i = 0; i < 5; i++) {
      clearCache('fy.');
      expect((await getForYou())[0].id).toBe('fav-new');
    }
  });
});

describe('newer wins between equally good videos', () => {
  it('newness counts for more in the first days', () => {
    expect(freshness(0.1)).toBeGreaterThan(1.8);
    expect(freshness(1)).toBeCloseTo(1.5);
    expect(freshness(3)).toBeCloseTo(1);
    expect(freshness(1) - freshness(5)).toBeGreaterThan(0.6); // more than any random variety
  });

  it("puts a channel's newest video first when it's about as good, not when it's clearly worse", () => {
    const d = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
    const older = v({ id: 'older', publishedAt: d(4) });
    const newer = v({ id: 'newer', publishedAt: d(1) });
    expect(diverse([{ v: older, s: 3 }, { v: newer, s: 2.7 }]).map((x) => x.id)).toEqual(['newer', 'older']);
    expect(diverse([{ v: older, s: 3 }, { v: newer, s: 1.5 }]).map((x) => x.id)).toEqual(['older', 'newer']);
  });

  it("in For you, a channel's uploads of similar quality come newest first, every time", async () => {
    const pub = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
    const vids: Record<string, Parameters<typeof ytVideo>[0]> = {};
    for (const [id, days, title] of [
      ['s-1', 1, 'chess lesson rook endgames'],
      ['s-2', 3, 'chess lesson knight forks'],
      ['s-3', 6, 'chess lesson pawn structure'],
      ['s-4', 9, 'chess lesson bishop pair'],
    ] as const)
      vids[id] = { id, channelId: 's', title, publishedAt: pub(days), views: 20_000 };
    for (const id of ['s-old1', 's-old2', 's-old3'])
      recordWatch({ ...v({ id, channelId: 's', title: 'chess lesson' }), duration: 600 }, 590);
    mockYouTube(
      {
        subscriptions: () => ({ items: [{ snippet: { resourceId: { channelId: 's' }, title: 'S', thumbnails: {} } }] }),
        channels: (p: URLSearchParams) => ({ items: p.get('id')!.split(',').map((id) => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })) }),
        playlistItems: () => ({ items: Object.keys(vids).map((id) => ({ contentDetails: { videoId: id, videoPublishedAt: vids[id].publishedAt } })) }),
        videos: (p: URLSearchParams) => (p.get('myRating') ? { items: [] } : { items: p.get('id')!.split(',').filter((id) => vids[id]).map((id) => ytVideo(vids[id])) }),
        search: () => ({ items: [] }),
      },
      { '/api/picks': () => ({ picks: [] }) },
    );
    for (let i = 0; i < 8; i++) {
      clearCache('fy.');
      expect((await getForYou()).map((x) => x.id)).toEqual(['s-1', 's-2', 's-3', 's-4']);
    }
  });
});
