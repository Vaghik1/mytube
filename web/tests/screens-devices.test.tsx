// Home and the player on a phone (touch). The TV version is in screens-tv.test.tsx.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../src/config';
import { Home } from '../src/pages/Home';
import { SUBTITLE_ENFORCE_MS, Watch } from '../src/pages/Watch';
import { isTouch } from '../src/tv';
import { installFakePlayer, liveRoutes } from './screens-fixtures';
import { mockYouTube, signIn } from './youtube-mock';

beforeEach(() => signIn());
afterEach(() => cleanup());

describe('on a phone', () => {
  it('runs in touch mode', () => expect(isTouch).toBe(true));

  it("Home is one list with ChatGPT's picks mixed in as normal videos", async () => {
    mockYouTube(liveRoutes(), {
      '/api/picks': () => ({ picks: [{ id: 'p', type: 'video', videoId: 'old1', reason: 'Exciting finish', status: 'new' }] }),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll('.grid .card').length).toBeGreaterThan(0));
    expect(document.querySelectorAll('.grid')).toHaveLength(1);
    expect(screen.getByText('Round 4 replay')).toBeTruthy();
    expect(screen.queryByText(/Exciting finish/)).toBeNull();
  });

  it('uses YouTube\'s normal tap controls in the player', async () => {
    mockYouTube(liveRoutes(), { '/api/picks': () => ({ picks: [] }) });
    const players = installFakePlayer();
    render(
      <MemoryRouter initialEntries={['/watch/live1']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(players).toHaveLength(1));
    expect(players[0].opts.playerVars.controls).toBe(1);
    expect(players[0].opts.playerVars.fs).toBe(1);
    delete (window as any).YT;
  });

  it("remembers subtitles turned on with YouTube's own CC button, like YouTube does", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mockYouTube(liveRoutes(), { '/api/picks': () => ({ picks: [] }) });
    const players = installFakePlayer();
    const view = render(
      <MemoryRouter initialEntries={['/watch/live1']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(players).toHaveLength(1));
    act(() => players[0].emit(1));
    vi.setSystemTime(Date.now() + SUBTITLE_ENFORCE_MS + 1000);
    act(() => players[0].youtubeTurnsSubtitlesOn('fr')); // the viewer tapped CC and picked French
    expect(players[0].subtitles).toBe('fr'); // not undone
    view.unmount();
    expect(loadSettings()).toMatchObject({ subtitles: true, subtitleLang: 'fr' });
    vi.useRealTimers();
    delete (window as any).YT;
  });

  it('player page has no Back button (Android back goes back) and shows details right away', async () => {
    mockYouTube(liveRoutes(), { '/api/picks': () => ({ picks: [] }) });
    render(
      <MemoryRouter initialEntries={['/watch/live1']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('← Back')).toBeNull();
    expect(await screen.findByText('Big tournament – round 5')).toBeTruthy();
    expect(screen.getByText('Not interested')).toBeTruthy();
    expect(screen.queryByText('▲ Back to video')).toBeNull(); // TV-only button
    expect(screen.queryByText(/OK play\/pause/)).toBeNull(); // TV remote hints
    expect(document.querySelector('.watch.web')).toBeTruthy();
  });

  it('a live stream from a watched channel leads For you (no separate Live section)', async () => {
    mockYouTube(liveRoutes(), {
      '/api/picks': () => ({ picks: [{ id: 'w', type: 'live_channel', channel: '@chess', title: 'Total Chess', status: 'new' }] }),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll('.grid .card').length).toBeGreaterThan(0));
    const titles = [...document.querySelectorAll('.grid .card .card-title')].map((e) => e.textContent);
    expect(titles[0]).toBe('Big tournament – round 5'); // live first
    expect(titles).toContain('Round 6 starts soon'); // starting soon is in the feed too
    expect(screen.getAllByText('● LIVE')).toHaveLength(1);
    expect(screen.queryByText('● Live now')).toBeNull();
    expect(screen.queryByText('Starting soon')).toBeNull();
    // one plain list: no chips / category tabs / ChatGPT tab
    expect(document.querySelector('.chips')).toBeNull();
    expect(screen.queryByText(/From ChatGPT/)).toBeNull();
    expect(screen.queryByText('For you')).toBeNull();
    // the replay is never labelled live
    const replay = [...document.querySelectorAll('.grid .card')].find((c) => c.textContent?.includes('Round 4 replay'));
    if (replay) expect(replay.textContent).not.toContain('LIVE');
  });
});
