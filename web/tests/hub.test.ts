// @vitest-environment node
// The assistant hub (/api/mcp, /api/picks, /api/sync) with storage replaced by memory.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (path: string, body: string) => {
    store.set(path, body);
    return { url: `mem://${path}` };
  }),
  get: vi.fn(async (path: string) => {
    if (!store.has(path)) return null;
    return { statusCode: 200, stream: new Response(store.get(path)).body };
  }),
}));

const KEY = 'k'.repeat(32);
let hub: typeof import('../api/hub');

beforeEach(async () => {
  store.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('MYTUBE_API_KEY', KEY);
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-123');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('BLOB_STORE_ID', 'store_1'); // new-style Vercel Blob connection (OIDC)
  vi.resetModules();
  hub = await import('../api/hub');
});

async function rpc(method: string, params?: unknown, key: string | null = KEY) {
  const url = `https://mytube.test/api/hub?r=mcp${key ? `&key=${key}` : ''}`;
  // Notifications have no id and get no reply.
  const msg = method.startsWith('notifications/') ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: 1, method, params };
  const res = await hub.POST(new Request(url, { method: 'POST', body: JSON.stringify(msg) }));
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}
const tool = async (name: string, args: unknown) => (await rpc('tools/call', { name, arguments: args })).body.result;

describe('MCP connection (ChatGPT plugin)', () => {
  it('rejects requests without the API key', async () => {
    const r = await rpc('tools/list', undefined, null);
    expect(r.status).toBe(401);
    expect((await rpc('tools/list', undefined, 'wrong-key-wrong-key')).status).toBe(401);
  });

  it('accepts the key as a Bearer header too', async () => {
    const res = await hub.POST(
      new Request('https://mytube.test/api/hub?r=mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('refuses everything when no key is configured', async () => {
    vi.stubEnv('MYTUBE_API_KEY', '');
    expect((await rpc('tools/list')).status).toBe(401);
  });

  it('completes the MCP handshake', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18' });
    expect(r.body.result.protocolVersion).toBe('2025-06-18');
    expect(r.body.result.serverInfo.name).toBe('mytube');
    expect(r.body.result.serverInfo.icons[0].src).toBe('https://mytube.test/icon-512.png');
    expect(r.body.result.capabilities.tools).toBeDefined();
    expect((await rpc('notifications/initialized')).status).toBe(202);
  });

  it('lists the five tools with input schemas', async () => {
    const { tools } = (await rpc('tools/list')).body.result;
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      'get_viewer_profile',
      'recommend_videos',
      'watch_channel_live',
      'update_viewer_preferences',
      'stop_watching_channel_live',
    ]);
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
    expect(tools[0].annotations.readOnlyHint).toBe(true);
  });

  it('answers unknown methods and tools with errors, not crashes', async () => {
    expect((await rpc('nope')).body.error.code).toBe(-32601);
    expect((await rpc('tools/call', { name: 'nope', arguments: {} })).body.error.code).toBe(-32602);
  });

  it('GET explains it needs POST', async () => {
    const res = await hub.GET(new Request('https://mytube.test/api/hub?r=mcp'));
    expect(res.status).toBe(405);
  });
});

describe('recommend_videos', () => {
  it('accepts URLs, short links and ids, and rejects junk', async () => {
    const r = await tool('recommend_videos', {
      items: [
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', reason: 'Classic' },
        { url: 'https://youtu.be/9bZkp7q19f0' },
        { url: 'https://www.youtube.com/shorts/abcdefghijk' },
        { url: 'not a video' },
      ],
    });
    expect(r.structuredContent.added).toBe(3);
    expect(r.structuredContent.skipped).toHaveLength(1);
    expect(r.isError).toBe(false);
  });

  it('asks for specific videos instead of topic searches (Home has no topic tab)', async () => {
    const r = await tool('recommend_videos', { items: [{ search_query: 'chess endgames' }] });
    expect(r.structuredContent.added).toBe(0);
    expect(r.structuredContent.skipped[0]).toMatch(/send specific YouTube videos/);
    const { tools } = (await rpc('tools/list')).body.result;
    const props = tools.find((t: { name: string }) => t.name === 'recommend_videos').inputSchema.properties.items.items.properties;
    expect(Object.keys(props)).not.toContain('search_query');
  });

  it('never sends the same pick twice', async () => {
    await tool('recommend_videos', { items: [{ url: 'dQw4w9WgXcQ' }] });
    const again = await tool('recommend_videos', { items: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }] });
    expect(again.structuredContent.added).toBe(0);
  });

  it('shows picks to the profile reader with their status', async () => {
    await tool('recommend_videos', { items: [{ url: 'dQw4w9WgXcQ', title: 'Song' }] });
    const p = (await tool('get_viewer_profile', {})).structuredContent;
    expect(p.your_previous_picks[0]).toMatchObject({ video_id: 'dQw4w9WgXcQ', status: 'new' });
  });
});

describe('watch_channel_live', () => {
  it('accepts @handles, channel URLs and ids; rejects websites', async () => {
    const r = await tool('watch_channel_live', {
      items: [
        { channel: '@chess', label: 'Total Chess' },
        { channel: 'https://www.youtube.com/channel/UC' + 'a'.repeat(22) },
        { channel: 'chess.com' },
      ],
    });
    expect(r.structuredContent.added).toBe(2);
    expect(r.structuredContent.skipped[0]).toMatch(/not a YouTube channel/);
  });

  it('updates instead of duplicating, and can stop watching', async () => {
    await tool('watch_channel_live', { items: [{ channel: '@chess' }] });
    const again = await tool('watch_channel_live', { items: [{ channel: '@Chess', until: '2026-12-01' }] });
    expect(again.structuredContent.added).toBe(0);
    expect(again.structuredContent.watching).toEqual(['@chess']);
    const stop = await tool('stop_watching_channel_live', { channels: ['@chess'] });
    expect(stop.structuredContent.stopped).toBe(1);
  });

  it('hides watches after their end date', async () => {
    await tool('watch_channel_live', { items: [{ channel: '@old', until: '2020-01-01' }, { channel: '@new' }] });
    const res = await hub.GET(new Request(`https://mytube.test/api/hub?r=picks&key=${KEY}`));
    const { picks } = await res.json();
    expect(picks.map((p: { channel: string }) => p.channel)).toEqual(['@new']);
  });
});

describe('/api/picks and /api/sync (TV app)', () => {
  const tokenInfo = (aud: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ aud, expires_in: '3600' }), { status: 200 })),
    );
  const tvReq = (r: string, init: RequestInit = {}) =>
    new Request(`https://mytube.test/api/hub?r=${r}`, { ...init, headers: { Authorization: 'Bearer ya29.tv-token' } });

  it('lets the signed-in TV app read picks', async () => {
    await tool('recommend_videos', { items: [{ url: 'dQw4w9WgXcQ' }] });
    tokenInfo('client-123');
    const res = await hub.GET(tvReq('picks'));
    expect(res.status).toBe(200);
    expect((await res.json()).picks).toHaveLength(1);
  });

  it("rejects Google tokens issued to someone else's app", async () => {
    tokenInfo('other-client');
    expect((await hub.GET(tvReq('picks'))).status).toBe(401);
  });

  it('the TV app cannot add picks (only ChatGPT with the key can)', async () => {
    tokenInfo('client-123');
    const res = await hub.POST(tvReq('picks', { method: 'POST', body: JSON.stringify({ url: 'dQw4w9WgXcQ' }) }));
    expect(res.status).toBe(401);
  });

  it('syncs the taste profile and marks watched / rejected picks', async () => {
    await tool('recommend_videos', { items: [{ url: 'aaaaaaaaaaa' }, { url: 'bbbbbbbbbbb' }, { url: 'ccccccccccc' }] });
    tokenInfo('client-123');
    const res = await hub.POST(
      tvReq('sync', {
        method: 'POST',
        body: JSON.stringify({
          watches: 3,
          topChannels: [{ id: 'c', title: 'Chess Channel', score: 2 }],
          topTopics: ['chess'],
          recent: [
            { id: 'aaaaaaaaaaa', title: 'A', channel: 'X', watchedPct: 80, at: new Date().toISOString() },
            { id: 'bbbbbbbbbbb', title: 'B', channel: 'X', watchedPct: 0, notInterested: true, at: new Date().toISOString() },
          ],
        }),
      }),
    );
    expect((await res.json()).pending).toBe(1);
    const p = (await tool('get_viewer_profile', {})).structuredContent;
    expect(p.favourite_channels).toEqual(['Chess Channel']);
    const status = Object.fromEntries(p.your_previous_picks.map((x: { video_id: string; status: string }) => [x.video_id, x.status]));
    expect(status).toEqual({ aaaaaaaaaaa: 'watched', bbbbbbbbbbb: 'dismissed', ccccccccccc: 'new' });
  });

  it('refuses sync without a Google token', async () => {
    const res = await hub.POST(new Request('https://mytube.test/api/hub?r=sync', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('does not recommend something already watched', async () => {
    tokenInfo('client-123');
    await hub.POST(
      tvReq('sync', {
        method: 'POST',
        body: JSON.stringify({ watches: 1, recent: [{ id: 'aaaaaaaaaaa', title: 'A', channel: 'X', watchedPct: 90, at: '' }] }),
      }),
    );
    const r = await tool('recommend_videos', { items: [{ url: 'aaaaaaaaaaa' }] });
    expect(r.structuredContent.added).toBe(0);
    expect(r.structuredContent.skipped[0]).toMatch(/already watched/);
  });
});

describe('storage connection', () => {
  it('works with the new Vercel connection (store id, no token)', async () => {
    const r = await tool('get_viewer_profile', {});
    expect(r.isError).toBe(false);
  });

  it('works with an old-style token under a custom prefix', async () => {
    vi.stubEnv('BLOB_STORE_ID', '');
    vi.stubEnv('MYTUBE_BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_x');
    expect((await tool('get_viewer_profile', {})).isError).toBe(false);
  });

  it('explains clearly when storage is not connected', async () => {
    vi.stubEnv('BLOB_STORE_ID', '');
    const r = await tool('get_viewer_profile', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/storage is not connected/i);
  });
});

describe('update_viewer_preferences', () => {
  const prefs = async (args: unknown) => (await tool('update_viewer_preferences', args)).structuredContent;

  it('adds interests, normalised and without duplicates', async () => {
    const r = await prefs({ add_interests: ['Chess', ' tennis ', 'chess', 'Physics', 'AI'] });
    expect(r.preferences.interests).toEqual(['chess', 'tennis', 'physics', 'ai']);
  });

  it('removes only what is asked and keeps the rest', async () => {
    await prefs({ add_interests: ['chess', 'tennis'], add_blocked_words: ['prank'] });
    const r = await prefs({ remove_interests: ['TENNIS'] });
    expect(r.preferences.interests).toEqual(['chess']);
    expect(r.preferences.blockedWords).toEqual(['prank']);
  });

  it('accepts YouTube channels as favourites and explains anything else', async () => {
    const r = await prefs({ add_favorite_channels: ['https://www.youtube.com/@GothamChess', 'UC' + 'b'.repeat(22), 'chess.com'] });
    expect(r.preferences.favoriteChannels).toEqual(['@GothamChess', 'UC' + 'b'.repeat(22)]);
    expect(r.notes[0]).toMatch(/@handle/);
  });

  it('keeps at most 3 live topics (each costs YouTube quota)', async () => {
    const r = await prefs({ add_live_topics: ['chess tournament', 'candidates chess', 'grand chess tour', 'tennis live'] });
    expect(r.preferences.liveTopics).toEqual(['candidates chess', 'grand chess tour', 'tennis live']);
    expect(r.notes.join(' ')).toMatch(/newest 3/);
  });

  it('turns Shorts off and back to the viewer\'s own choice', async () => {
    expect((await prefs({ hide_shorts: true })).preferences.hideShorts).toBe(true);
    expect((await prefs({ hide_shorts: null })).preferences.hideShorts).toBeUndefined();
  });

  it('can reset everything it set', async () => {
    await prefs({ add_interests: ['chess'], add_disliked_topics: ['celebrity gossip'], hide_shorts: true });
    const r = await prefs({ reset: true, add_interests: ['physics'] });
    expect(r.preferences).toMatchObject({ interests: ['physics'], dislikedTopics: [] });
    expect(r.preferences.hideShorts).toBeUndefined();
  });

  it('shows the preferences in the viewer profile', async () => {
    await prefs({ add_disliked_topics: ['Celebrity Gossip'] });
    const p = (await tool('get_viewer_profile', {})).structuredContent;
    expect(p.preferences_you_set.dislikedTopics).toEqual(['celebrity gossip']);
  });

  it('gives them to the TV app with the picks; the TV can reset but not change them', async () => {
    await prefs({ add_interests: ['chess'] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ aud: 'client-123', expires_in: '3600' }))));
    const tv = (init: RequestInit = {}) =>
      new Request('https://mytube.test/api/hub?r=picks', { ...init, headers: { Authorization: 'Bearer ya29.tv' } });
    expect((await (await hub.GET(tv())).json()).preferences.interests).toEqual(['chess']);
    const denied = await hub.POST(tv({ method: 'POST', body: JSON.stringify({ action: 'update_preferences', add_interests: ['x'] }) }));
    expect(denied.status).toBe(401);
    const reset = await hub.POST(tv({ method: 'POST', body: JSON.stringify({ action: 'reset_preferences' }) }));
    expect((await reset.json()).preferences.interests).toEqual([]);
  });

  it('can also be updated over REST with the API key', async () => {
    const res = await hub.POST(
      new Request(`https://mytube.test/api/hub?r=picks&key=${KEY}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'update_preferences', add_blocked_channels: ['Drama Channel'] }),
      }),
    );
    expect((await res.json()).preferences.blockedChannels).toEqual(['Drama Channel']);
  });
});
