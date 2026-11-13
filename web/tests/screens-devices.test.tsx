// Home and the player on a phone (touch). The TV version is in screens-tv.test.tsx.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Home } from '../src/pages/Home';
import { Watch } from '../src/pages/Watch';
import { isTouch } from '../src/tv';
import { installFakePlayer, liveRoutes } from './screens-fixtures';
import { mockYouTube, signIn } from './youtube-mock';

beforeEach(() => signIn());
afterEach(() => cleanup());

describe('on a phone', () => {
  it('runs in touch mode', () => expect(isTouch).toBe(true));

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

  it('player page has a Back button and shows details right away', async () => {
    mockYouTube(liveRoutes(), { '/api/picks': () => ({ picks: [] }) });
    render(
      <MemoryRouter initialEntries={['/watch/live1']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('← Back')).toBeTruthy();
    expect(await screen.findByText('Big tournament – round 5')).toBeTruthy();
    expect(screen.getByText('Not interested')).toBeTruthy();
    expect(screen.queryByText('▲ Back to video')).toBeNull(); // TV-only button
    expect(screen.queryByText(/OK play\/pause/)).toBeNull(); // TV remote hints
    expect(document.querySelector('.watch.web')).toBeTruthy();
  });

  it('Home shows Live now first when a watched channel is live', async () => {
    mockYouTube(liveRoutes(), {
      '/api/picks': () => ({ picks: [{ id: 'w', type: 'live_channel', channel: '@chess', title: 'Total Chess', status: 'new' }] }),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(await screen.findByText('● Live now')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('● LIVE').length).toBeGreaterThan(0));
    const sections = [...document.querySelectorAll('.section-title, .chips')].map((e) => e.className);
    expect(sections[0]).toContain('live-title'); // above the chips
    expect(screen.getByText('Starting soon')).toBeTruthy();
  });
});
