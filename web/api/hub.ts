// MyTube assistant hub: lets ChatGPT (or any automation) read your taste and send you video picks.
//
//   /api/mcp    MCP server (for a ChatGPT custom connector). Auth: ?key=MYTUBE_API_KEY or Bearer key.
//   /api/picks  GET list · POST add (API key) · POST {action:"dismiss"|"watched"} (TV or key)
//   /api/sync   POST taste profile from the TV app (Google sign-in token)
//
// Env vars (Vercel → Settings → Environment Variables):
//   MYTUBE_API_KEY          a long random secret you choose; give it to ChatGPT
//   BLOB_STORE_ID           added automatically when you connect a Blob store (uses Vercel OIDC sign-in);
//                           an older-style BLOB_READ_WRITE_TOKEN also works
//   GOOGLE_CLIENT_ID        already set; used to check the TV app's sign-in token
//
// All routes are rewritten to this single file in vercel.json.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { get, put } from '@vercel/blob';

// ── storage ─────────────────────────────────────────────────

type Pick = {
  id: string;
  type: 'video' | 'search' | 'live_channel';
  /** live_channel: YouTube channel (@handle, URL or UC… id) whose live streams should be featured. */
  channel?: string;
  /** live_channel: stop featuring after this date (ISO). */
  until?: string;
  videoId?: string;
  query?: string;
  title?: string;
  reason?: string;
  source: string;
  addedAt: string;
  status: 'new' | 'watched' | 'dismissed';
};

type RecentWatch = { id: string; title: string; channel: string; watchedPct: number; liked?: boolean; notInterested?: boolean; at: string };

type State = {
  profile?: {
    updatedAt: string;
    watches: number;
    topChannels: { id: string; title: string; score: number }[];
    topTopics: string[];
    recent: RecentWatch[];
    hideShorts?: boolean;
    blockedChannels?: string[];
    blockedKeywords?: string[];
  };
  picks: Pick[];
  /** Preferences managed by ChatGPT; applied by the TV/phone app. */
  preferences?: Prefs;
};

type Prefs = {
  interests: string[];
  favoriteChannels: string[];
  liveTopics: string[];
  dislikedTopics: string[];
  blockedChannels: string[];
  blockedWords: string[];
  hideShorts?: boolean;
  updatedAt?: string;
};

const PREF_LISTS = ['interests', 'favoriteChannels', 'liveTopics', 'dislikedTopics', 'blockedChannels', 'blockedWords'] as const;
const LIMITS: Record<(typeof PREF_LISTS)[number], number> = {
  interests: 30,
  favoriteChannels: 30,
  liveTopics: 3, // each live topic costs a YouTube search (100 units) about every 90 minutes
  dislikedTopics: 50,
  blockedChannels: 100,
  blockedWords: 100,
};
const emptyPrefs = (): Prefs => ({ interests: [], favoriteChannels: [], liveTopics: [], dislikedTopics: [], blockedChannels: [], blockedWords: [] });
const CHANNEL_RE = /(UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9._-]+)/;

const PATH = () =>
  `mytube/${createHash('sha256')
    .update(String(process.env.GOOGLE_CLIENT_SECRET || process.env.MYTUBE_API_KEY || 'mytube'))
    .digest('hex')
    .slice(0, 24)}/state.json`;

let access: 'private' | 'public' = 'private';

/** Finds the Blob key even if the store was connected with a custom prefix (e.g. MYTUBE_BLOB_READ_WRITE_TOKEN). */
function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  return Object.entries(process.env).find(([k, v]) => k.endsWith('BLOB_READ_WRITE_TOKEN') && v)?.[1];
}

async function load(): Promise<State> {
  const token = blobToken();
  if (!token && !process.env.BLOB_STORE_ID) {
    const seen = Object.keys(process.env).filter((k) => /BLOB|STORAGE/i.test(k));
    throw new Error(
      `MyTube storage is not connected yet: no BLOB_READ_WRITE_TOKEN in this deployment (related variables seen: ${seen.join(', ') || 'none'}). ` +
        'In Vercel open the mytube project → Storage → connect the Blob store (all environments), then Redeploy.',
    );
  }
  for (const a of [access, access === 'private' ? 'public' : 'private'] as const) {
    try {
      const r = await get(PATH(), { access: a, useCache: false, ...(token ? { token } : {}) });
      access = a;
      if (!r || r.statusCode !== 200) return { picks: [] };
      const text = await new Response(r.stream).text();
      const s = JSON.parse(text) as State;
      return { ...s, picks: s.picks || [] };
    } catch (e) {
      const msg = String((e as Error).message || e);
      if (/not.?found/i.test(msg)) return { picks: [] };
      if (a !== access) throw e; // both access modes failed
    }
  }
  return { picks: [] };
}

async function save(s: State) {
  s.picks = s.picks
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
    .filter((p, i) => p.status === 'new' || i < 300)
    .slice(0, 400);
  const body = JSON.stringify(s);
  const token = blobToken();
  try {
    await put(PATH(), body, { access, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ...(token ? { token } : {}) });
  } catch (e) {
    access = access === 'private' ? 'public' : 'private';
    await put(PATH(), body, { access, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ...(token ? { token } : {}) });
  }
}

// ── auth ────────────────────────────────────────────────────

function hasKey(req: Request, url: URL) {
  const want = process.env.MYTUBE_API_KEY;
  if (!want || want.length < 16) return false;
  const auth = req.headers.get('authorization') || '';
  const got = (auth.startsWith('Bearer ') ? auth.slice(7) : '') || url.searchParams.get('key') || req.headers.get('x-api-key') || '';
  const a = Buffer.from(createHash('sha256').update(got).digest('hex'));
  const b = Buffer.from(createHash('sha256').update(want).digest('hex'));
  return timingSafeEqual(a, b);
}

const tokenCache = new Map<string, number>();
/** The TV app proves itself with its Google sign-in token, issued to our own OAuth client. */
async function isTvApp(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ya29.')) return false;
  const tok = auth.slice(7);
  const hit = tokenCache.get(tok);
  if (hit && hit > Date.now()) return true;
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tok)}`);
  if (!r.ok) return false;
  const info = (await r.json()) as { aud?: string; azp?: string; expires_in?: string };
  const ok = !!process.env.GOOGLE_CLIENT_ID && (info.aud === process.env.GOOGLE_CLIENT_ID || info.azp === process.env.GOOGLE_CLIENT_ID);
  if (ok) tokenCache.set(tok, Date.now() + Math.min(300, Number(info.expires_in || 60)) * 1000);
  return ok;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ── picks logic (shared by REST and MCP) ───────────────────

function videoIdFrom(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1];
}

type PickInput = { video?: string; video_id?: string; url?: string; search_query?: string; query?: string; title?: string; reason?: string };

async function addPicks(items: PickInput[], source: string) {
  const s = await load();
  const added: Pick[] = [];
  const skipped: string[] = [];
  for (const it of items.slice(0, 25)) {
    const videoId = videoIdFrom(it.video_id || it.video || it.url);
    const query = (it.search_query || it.query || '').trim().slice(0, 120);
    if (!videoId) {
      skipped.push(
        query
          ? `"${query}": send specific YouTube videos, not searches (they appear in the viewer's video list)`
          : `not a YouTube video: ${JSON.stringify(it).slice(0, 80)}`,
      );
      continue;
    }
    const dup = s.picks.find((p) => (videoId ? p.videoId === videoId : p.query?.toLowerCase() === query.toLowerCase()));
    const watched = videoId && s.profile?.recent.some((r) => r.id === videoId && r.watchedPct >= 50);
    if (dup || watched) {
      skipped.push(`${videoId || query}: already ${watched ? 'watched' : 'suggested'}`);
      continue;
    }
    const p: Pick = {
      id: randomUUID().slice(0, 8),
      type: videoId ? 'video' : 'search',
      videoId,
      query: videoId ? undefined : query,
      title: it.title?.slice(0, 200),
      reason: it.reason?.slice(0, 300),
      source: source.slice(0, 40),
      addedAt: new Date().toISOString(),
      status: 'new',
    };
    s.picks.unshift(p);
    added.push(p);
  }
  if (added.length) await save(s);
  return { added: added.length, skipped, pending: s.picks.filter((p) => p.status === 'new').length };
}

type LiveInput = { channel?: string; url?: string; label?: string; reason?: string; until?: string };

async function addLiveWatches(items: LiveInput[], source: string) {
  const s = await load();
  const added: Pick[] = [];
  const skipped: string[] = [];
  for (const it of items.slice(0, 20)) {
    const channel = (it.channel || it.url || '').trim().slice(0, 200);
    if (!/(UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9._-]+)/.test(channel)) {
      skipped.push(`not a YouTube channel (use @handle, channel URL or UC… id): ${channel.slice(0, 60)}`);
      continue;
    }
    const key = channel.toLowerCase();
    const existing = s.picks.find((p) => p.type === 'live_channel' && p.status === 'new' && p.channel?.toLowerCase() === key);
    if (existing) {
      existing.until = it.until || existing.until;
      existing.reason = it.reason?.slice(0, 300) || existing.reason;
      existing.title = it.label?.slice(0, 120) || existing.title;
      skipped.push(`${channel}: already watched, updated`);
      continue;
    }
    const p: Pick = {
      id: randomUUID().slice(0, 8),
      type: 'live_channel',
      channel,
      title: it.label?.slice(0, 120),
      reason: it.reason?.slice(0, 300),
      until: it.until,
      source: source.slice(0, 40),
      addedAt: new Date().toISOString(),
      status: 'new',
    };
    s.picks.unshift(p);
    added.push(p);
  }
  await save(s);
  return {
    added: added.length,
    skipped,
    watching: s.picks.filter((p) => p.type === 'live_channel' && p.status === 'new').map((p) => p.channel),
  };
}

async function stopLiveWatches(channels: string[]) {
  const s = await load();
  const want = new Set(channels.map((c) => c.trim().toLowerCase()));
  let n = 0;
  for (const p of s.picks) if (p.type === 'live_channel' && p.status === 'new' && want.has((p.channel || '').toLowerCase())) (p.status = 'dismissed'), n++;
  if (n) await save(s);
  return { stopped: n };
}

type PrefsInput = {
  hide_shorts?: boolean | null;
  reset?: boolean;
} & Partial<Record<`${'add' | 'remove'}_${'interests' | 'favorite_channels' | 'live_topics' | 'disliked_topics' | 'blocked_channels' | 'blocked_words'}`, string[]>>;

const KEYS: Record<string, (typeof PREF_LISTS)[number]> = {
  interests: 'interests',
  favorite_channels: 'favoriteChannels',
  live_topics: 'liveTopics',
  disliked_topics: 'dislikedTopics',
  blocked_channels: 'blockedChannels',
  blocked_words: 'blockedWords',
};

function cleanItem(list: (typeof PREF_LISTS)[number], raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!v) return undefined;
  if (list === 'favoriteChannels') return v.match(CHANNEL_RE)?.[1];
  if (list === 'blockedChannels') return v; // id, @handle or exact channel name
  return v.toLowerCase();
}

async function updatePreferences(input: PrefsInput) {
  const s = await load();
  const prefs: Prefs = input.reset ? emptyPrefs() : { ...emptyPrefs(), ...s.preferences };
  const notes: string[] = [];
  for (const [name, list] of Object.entries(KEYS)) {
    const add = (input as Record<string, unknown>)[`add_${name}`];
    const remove = (input as Record<string, unknown>)[`remove_${name}`];
    if (Array.isArray(remove)) {
      const rm = new Set(remove.map((x) => cleanItem(list, x)?.toLowerCase()).filter(Boolean));
      prefs[list] = prefs[list].filter((x) => !rm.has(x.toLowerCase()));
    }
    if (Array.isArray(add)) {
      for (const raw of add) {
        const v = cleanItem(list, raw);
        if (!v) {
          notes.push(list === 'favoriteChannels' ? `${String(raw).slice(0, 60)}: use a YouTube @handle, channel URL or UC… id` : `ignored: ${String(raw).slice(0, 60)}`);
          continue;
        }
        if (!prefs[list].some((x) => x.toLowerCase() === v.toLowerCase())) prefs[list].push(v);
      }
      if (prefs[list].length > LIMITS[list]) {
        notes.push(`${name}: kept the newest ${LIMITS[list]}`);
        prefs[list] = prefs[list].slice(-LIMITS[list]);
      }
    }
  }
  if (input.hide_shorts === null) delete prefs.hideShorts;
  else if (typeof input.hide_shorts === 'boolean') prefs.hideShorts = input.hide_shorts;
  prefs.updatedAt = new Date().toISOString();
  s.preferences = prefs;
  await save(s);
  return { preferences: prefs, notes };
}

function viewerSummary(s: State) {
  const p = s.profile;
  return {
    note: p
      ? 'Taste profile learned from what the viewer watches in MyTube (watch time, likes, "not interested"). Recommend YouTube videos they have not seen.'
      : 'The TV app has not synced a profile yet. Recommend broadly and check back later.',
    profile_updated: p?.updatedAt,
    videos_watched_in_mytube: p?.watches ?? 0,
    favourite_channels: p?.topChannels.slice(0, 15).map((c) => c.title) ?? [],
    favourite_topics: p?.topTopics.slice(0, 25) ?? [],
    recently_watched: p?.recent.slice(0, 25) ?? [],
    dislikes: { blocked_channels: p?.blockedChannels ?? [], blocked_words: p?.blockedKeywords ?? [], hides_shorts: p?.hideShorts ?? false },
    preferences_you_set: s.preferences ?? emptyPrefs(),
    live_channels_watched: s.picks
      .filter((p) => p.type === 'live_channel' && p.status === 'new')
      .map((p) => ({ channel: p.channel, label: p.title, until: p.until })),
    your_previous_picks: s.picks.filter((p) => p.type !== 'live_channel').slice(0, 30).map((x) => ({
      video_id: x.videoId,
      search: x.query,
      title: x.title,
      status: x.status,
      added: x.addedAt,
    })),
  };
}

// ── MCP (Streamable HTTP, stateless JSON responses) ─────────

const TOOLS = [
  {
    name: 'get_viewer_profile',
    title: 'Get viewer taste profile',
    description:
      "Returns what the MyTube viewer likes: favourite channels and topics, recently watched videos with how much they watched, what they disliked, and the picks you already sent (with status new/watched/dismissed). Call this first, then find new YouTube videos they'd enjoy.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'recommend_videos',
    title: 'Send video picks to the TV',
    description:
      "Adds YouTube videos to the viewer's MyTube video list (TV and phone), merged with their subscriptions: about one in every three videos comes from you. Each item must be a specific YouTube video (URL or 11-character id). Send 5-10 per run. Only send videos genuinely likely to interest them; skip anything already watched or already suggested.",
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'YouTube video URL or id' },
              title: { type: 'string', description: 'Video title' },
              reason: { type: 'string', description: 'One short sentence: why this fits the viewer (kept for your own records)' },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'watch_channel_live',
    title: 'Feature a channel\'s live streams',
    description:
      "Tells MyTube to watch YouTube channels for live (and soon-starting) broadcasts and put them at the top of the viewer's video list whenever they open MyTube. Use for official channels that stream events the viewer cares about (e.g. major chess tournaments). Give the channel as @handle, channel URL or UC… id; optionally an end date when the event is over. The app only marks something LIVE when YouTube reports it as live, so replays are never shown as live.",
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'YouTube channel: @handle, channel URL or UC… id' },
              label: { type: 'string', description: 'Short label, e.g. "Total Chess World Championship Tour"' },
              reason: { type: 'string', description: 'Why the viewer would care' },
              until: { type: 'string', description: 'ISO date after which to stop featuring (optional)' },
            },
            required: ['channel'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_viewer_preferences',
    title: 'Update the viewer\'s MyTube preferences',
    description:
      "Changes what MyTube shows the viewer. Interests are searched for and ranked higher; favourite channels' new uploads are added; live topics are searched on YouTube for streams that are live right now (about every 90 minutes, max 3 topics) and put at the top; disliked topics and blocked channels/words are hidden; hide_shorts hides videos of 3 minutes or less. Use add_* / remove_* lists (only the changes), hide_shorts true/false (null = back to the viewer's own setting), or reset: true to clear everything you set before. Returns the full current preferences.",
    inputSchema: {
      type: 'object',
      properties: {
        add_interests: { type: 'array', items: { type: 'string' }, description: 'Short search phrases of 1-4 words, e.g. "chess", "queen\'s gambit", "james webb telescope". Never sentences. Max 30 kept.' },
        remove_interests: { type: 'array', items: { type: 'string' } },
        add_favorite_channels: { type: 'array', items: { type: 'string' }, description: 'YouTube @handle, channel URL or UC… id. Add the 2-3 best channels for each interest: their new uploads are followed cheaply. Max 30 kept.' },
        remove_favorite_channels: { type: 'array', items: { type: 'string' } },
        add_live_topics: { type: 'array', items: { type: 'string' }, description: 'Search phrases for live streams, e.g. "chess tournament live"' },
        remove_live_topics: { type: 'array', items: { type: 'string' } },
        add_disliked_topics: { type: 'array', items: { type: 'string' }, description: 'Hidden when all words appear in a title/tags, e.g. "celebrity gossip"' },
        remove_disliked_topics: { type: 'array', items: { type: 'string' } },
        add_blocked_channels: { type: 'array', items: { type: 'string' }, description: 'Channel id, @handle or exact name' },
        remove_blocked_channels: { type: 'array', items: { type: 'string' } },
        add_blocked_words: { type: 'array', items: { type: 'string' }, description: 'Hide videos whose title contains these words' },
        remove_blocked_words: { type: 'array', items: { type: 'string' } },
        hide_shorts: { type: ['boolean', 'null'] },
        reset: { type: 'boolean', description: 'Clear all preferences you set before applying the rest' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'stop_watching_channel_live',
    title: 'Stop featuring a channel\'s live streams',
    description: 'Removes channels previously added with watch_channel_live.',
    inputSchema: {
      type: 'object',
      properties: { channels: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['channels'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

async function mcp(req: Request, url: URL) {
  if (req.method === 'GET') return new Response('MyTube MCP server. Use POST (Streamable HTTP).', { status: 405, headers: { Allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  if (!hasKey(req, url)) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: add ?key=YOUR_MYTUBE_API_KEY to the URL' } }, 401);

  const body = await req.json().catch(() => null);
  const msgs = Array.isArray(body) ? body : [body];
  const out: unknown[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    const { id, method, params } = m as { id?: string | number; method?: string; params?: any };
    if (id === undefined || id === null) continue; // notification
    const reply = (result: unknown) => out.push({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => out.push({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      if (method === 'initialize') {
        reply({
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'mytube',
            title: 'MyTube TV',
            version: '1.1.0',
            icons: [
              { src: `${url.origin}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
              { src: `${url.origin}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
            ],
          },
          instructions:
            "MyTube is the viewer's personal YouTube app (TV and phone). MyTube can only afford a few YouTube searches a day, so YOU are its discovery engine. On each run: (1) call get_viewer_profile; (2) search the web for specific, recent, high-quality YouTube videos across the viewer's interests and favourite topics, rotating through different interests each run; (3) call recommend_videos with 5-10 picks (a short reason each), never resending anything already watched or suggested. Your picks are merged with the viewer's subscriptions (about one in three videos). For live events the viewer cares about (major tournaments, premieres), call watch_channel_live with the official broadcaster's channel. With update_viewer_preferences: keep interests as short search phrases of 1-4 words (e.g. 'queen's gambit', 'james webb telescope', never sentences), and for each interest add its 2-3 best YouTube channels as favourite channels, because MyTube follows favourite channels' uploads at almost no cost. Quality over quantity.",
        });
      } else if (method === 'ping') reply({});
      else if (method === 'tools/list') reply({ tools: TOOLS });
      else if (method === 'tools/call') {
        const name = params?.name;
        const args = params?.arguments || {};
        let result: unknown;
        if (name === 'get_viewer_profile') result = viewerSummary(await load());
        else if (name === 'recommend_videos') result = await addPicks(Array.isArray(args.items) ? args.items : [], 'ChatGPT');
        else if (name === 'watch_channel_live') result = await addLiveWatches(Array.isArray(args.items) ? args.items : [], 'ChatGPT');
        else if (name === 'stop_watching_channel_live') result = await stopLiveWatches(Array.isArray(args.channels) ? args.channels : []);
        else if (name === 'update_viewer_preferences') result = await updatePreferences(args);
        else {
          fail(-32602, `Unknown tool: ${name}`);
          continue;
        }
        reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
      } else if (method === 'resources/list') reply({ resources: [] });
      else if (method === 'prompts/list') reply({ prompts: [] });
      else fail(-32601, `Method not found: ${method}`);
    } catch (e) {
      reply({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
    }
  }
  if (!out.length) return new Response(null, { status: 202 });
  return json(Array.isArray(body) ? out : out[0]);
}

// ── REST ────────────────────────────────────────────────────

async function picks(req: Request, url: URL) {
  const key = hasKey(req, url);
  const tv = key ? false : await isTvApp(req);
  if (!key && !tv) return json({ error: 'unauthorized' }, 401);
  const s = await load();
  if (req.method === 'GET') {
    const all = url.searchParams.get('all') === '1';
    const now = new Date().toISOString();
    const visible = s.picks.filter((p) => all || (p.status === 'new' && !(p.until && p.until < now)));
    return json({ picks: visible, preferences: s.preferences ?? emptyPrefs(), profile: key ? viewerSummary(s) : undefined });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; videoId?: string; items?: PickInput[] } & PickInput;
  if (body.action === 'reset_preferences') return json(await updatePreferences({ reset: true }));
  if (body.action === 'update_preferences') {
    if (!key) return json({ error: 'updating preferences needs the API key' }, 401);
    return json(await updatePreferences(body as PrefsInput));
  }
  if (body.action === 'dismiss' || body.action === 'watched') {
    let n = 0;
    for (const p of s.picks) {
      if ((body.id && p.id === body.id) || (body.videoId && p.videoId === body.videoId)) {
        p.status = body.action === 'dismiss' ? 'dismissed' : 'watched';
        n++;
      }
    }
    if (n) await save(s);
    return json({ updated: n });
  }
  if (!key) return json({ error: 'adding picks needs the API key' }, 401);
  if (body.action === 'watch_live') return json(await addLiveWatches((body as any).items || [body], url.searchParams.get('source') || 'API'));
  const items = Array.isArray(body.items) ? body.items : [body];
  return json(await addPicks(items, url.searchParams.get('source') || 'API'));
}

async function sync(req: Request) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!(await isTvApp(req))) return json({ error: 'unauthorized' }, 401);
  const body = (await req.json().catch(() => null)) as State['profile'] | null;
  if (!body) return json({ error: 'bad body' }, 400);
  const s = await load();
  s.profile = {
    updatedAt: new Date().toISOString(),
    watches: Number(body.watches) || 0,
    topChannels: (body.topChannels || []).slice(0, 30),
    topTopics: (body.topTopics || []).slice(0, 50),
    recent: (body.recent || []).slice(0, 60),
    hideShorts: !!body.hideShorts,
    blockedChannels: (body.blockedChannels || []).slice(0, 100),
    blockedKeywords: (body.blockedKeywords || []).slice(0, 100),
  };
  // Picks the viewer has since watched or rejected on the TV.
  for (const p of s.picks) {
    if (p.status !== 'new' || !p.videoId) continue;
    const r = s.profile.recent.find((w) => w.id === p.videoId);
    if (r?.notInterested) p.status = 'dismissed';
    else if (r && r.watchedPct >= 30) p.status = 'watched';
  }
  await save(s);
  return json({ ok: true, pending: s.picks.filter((p) => p.status === 'new').length });
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const route = url.searchParams.get('r') || url.pathname.split('/').pop();
  try {
    if (route === 'mcp') return await mcp(req, url);
    if (route === 'picks') return await picks(req, url);
    if (route === 'sync') return await sync(req);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
