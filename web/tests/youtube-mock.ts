// A tiny fake of the YouTube Data API used by the unit tests.
import { vi } from 'vitest';

export type FakeVideo = {
  id: string;
  channelId: string;
  title?: string;
  duration?: string; // ISO 8601
  live?: 'live' | 'upcoming' | 'none';
  scheduledStart?: string;
  publishedAt?: string;
  tags?: string[];
};

export function ytVideo(v: FakeVideo) {
  return {
    id: v.id,
    snippet: {
      title: v.title || `Video ${v.id}`,
      channelId: v.channelId,
      channelTitle: `${v.channelId} channel`,
      publishedAt: v.publishedAt || new Date().toISOString(),
      liveBroadcastContent: v.live || 'none',
      categoryId: '20',
      tags: v.tags,
      thumbnails: {},
    },
    contentDetails: { duration: v.duration ?? 'PT10M' },
    statistics: { viewCount: '1000', likeCount: '10' },
    liveStreamingDetails: v.scheduledStart ? { scheduledStartTime: v.scheduledStart } : undefined,
  };
}

export type Handler = (params: URLSearchParams, init?: RequestInit) => unknown;

/** Installs a fetch mock. `routes` maps API paths (e.g. "videos") to handlers. Returns the mock. */
export function mockYouTube(routes: Record<string, Handler>, extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://mytube.test');
    if (url.hostname === 'www.googleapis.com') {
      const path = url.pathname.replace('/youtube/v3/', '');
      const h = routes[path];
      if (!h) return new Response(JSON.stringify({ error: { message: `no mock for ${path}` } }), { status: 404 });
      const body = h(url.searchParams, init);
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const h = extra[url.pathname];
    if (h) {
      const body = h(init);
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `no mock for ${url.pathname}` }), { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Pretends the user is signed in with a valid Google token. */
export function signIn(expiresInMs = 3600_000) {
  localStorage.setItem(
    'mytube.tokens',
    JSON.stringify({ access_token: 'ya29.test', refresh_token: 'refresh-1', expires_at: Date.now() + expiresInMs }),
  );
}

export function calls(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  return fetchMock.mock.calls
    .map(([u]) => new URL(String(u), 'https://mytube.test'))
    .filter((u) => u.pathname.endsWith(path));
}
