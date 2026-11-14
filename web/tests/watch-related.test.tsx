// Phone video page: what shows under the video.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../src/api';

const v = (id: string, channelId = 'c1'): Video => ({
  id, title: `Video ${id}`, channelId, channelTitle: channelId === 'c1' ? 'GothamChess' : 'Other',
  publishedAt: new Date().toISOString(), thumb: '', duration: 600, views: 1000, likes: 10, live: false,
  description: 'Line one\nLine two\nLine three https://example.com/a-very-long-link',
});

vi.mock('../src/api', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getVideo: vi.fn(async (id: string) => v(id)),
    getVideos: vi.fn(async (ids: string[]) => ids.map((i) => v(i))),
    getRating: vi.fn(async () => 'none'),
    getChannelVideos: vi.fn(async () => ({ items: ['cur', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'].map((i) => v(i)) })),
    getForYou: vi.fn(async () => ['fy1', 'ch2', 'fy2', 'cur'].map((i) => v(i, 'c2'))),
  };
});

const { Watch, relatedVideos, SAME_CHANNEL_COUNT } = await import('../src/pages/Watch');

afterEach(() => cleanup());

describe('videos under a video (like YouTube)', () => {
  it('a few from the same channel, then For you; no repeats and not the video itself', async () => {
    const ids = (await relatedVideos(v('cur'))).map((x) => x.id);
    expect(ids.slice(0, SAME_CHANNEL_COUNT)).toEqual(['ch1', 'ch2', 'ch3', 'ch4']);
    expect(ids).toContain('fy1');
    expect(ids.indexOf('fy1')).toBeLessThan(ids.indexOf('ch6'));
    expect(ids).not.toContain('cur');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the phone page shows a short description box that opens on tap, then the videos', async () => {
    (window as any).YT = { Player: class { constructor() {} destroy() {} } };
    render(
      <MemoryRouter initialEntries={['/watch/cur']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    const box = await screen.findByText('…more');
    expect(document.querySelector('.desc-box')!.className).not.toContain('open');
    expect(document.querySelector('.desc-meta')!.textContent).toMatch(/views/);
    await waitFor(() => expect(screen.getByText('Video fy1')).toBeTruthy());
    expect(screen.getByText('Up next')).toBeTruthy();
    act(() => fireEvent.click(box));
    expect(document.querySelector('.desc-box')!.className).toContain('open');
    expect(screen.getByText('Show less')).toBeTruthy();
    delete (window as any).YT;
  });
});

describe('resume where you left off', () => {
  it('a video you did not finish starts from where you stopped', async () => {
    const { recordWatch } = await import('../src/history');
    recordWatch(v('half'), 300, 312.4);
    const made: any[] = [];
    (window as any).YT = { Player: class { constructor(_e: unknown, o: any) { made.push(o); } destroy() {} } };
    render(
      <MemoryRouter initialEntries={['/watch/half']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(made).toHaveLength(1));
    expect(made[0].playerVars.start).toBe(312);
    delete (window as any).YT;
  });

  it('a new video starts from the beginning', async () => {
    const made: any[] = [];
    (window as any).YT = { Player: class { constructor(_e: unknown, o: any) { made.push(o); } destroy() {} } };
    render(
      <MemoryRouter initialEntries={['/watch/fresh']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(made).toHaveLength(1));
    expect(made[0].playerVars.start).toBeUndefined();
    delete (window as any).YT;
  });
});

describe('sponsor skipping in the player', () => {
  it('jumps over a sponsor segment once and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('skipSegments'))
        return { ok: true, status: 200, json: async () => [{ videoID: 'spons', segments: [{ segment: [60, 120], category: 'sponsor', UUID: 's1' }] }] };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    const players: any[] = [];
    (window as any).YT = {
      Player: class {
        t = 61;
        seeks: number[] = [];
        constructor(_e: unknown, public o: any) { players.push(this); }
        getCurrentTime() { return this.t; }
        getDuration() { return 600; }
        getPlayerState() { return 1; }
        seekTo(t: number) { this.seeks.push(t); this.t = t; }
        destroy() {}
      },
    };
    render(
      <MemoryRouter initialEntries={['/watch/spons']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(players).toHaveLength(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    expect(players[0].seeks).toEqual([120]);
    expect(screen.getByText('Skipped sponsor')).toBeTruthy();
    players[0].t = 70; // you go back into it on purpose
    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    expect(players[0].seeks).toEqual([120]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as any).YT;
  });
});

describe('Play on TV button (phone)', () => {
  it('sends the video with the current time and pauses the phone', async () => {
    const { signIn } = await import('./youtube-mock');
    signIn();
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/remote') posts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: url === '/api/remote' ? 200 : 404 });
    }));
    const players: any[] = [];
    (window as any).YT = {
      Player: class {
        paused = false;
        constructor() { players.push(this); }
        getCurrentTime() { return 95.5; }
        pauseVideo() { this.paused = true; }
        destroy() {}
      },
    };
    render(
      <MemoryRouter initialEntries={['/watch/tvvid']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(players).toHaveLength(1));
    fireEvent.click(await screen.findByText('📺 Play on TV'));
    await waitFor(() => expect(screen.getByText('Playing on your TV')).toBeTruthy());
    expect(posts).toEqual([{ videoId: 'tvvid', start: 95 }]);
    expect(players[0].paused).toBe(true);
    vi.unstubAllGlobals();
    delete (window as any).YT;
  });
});
