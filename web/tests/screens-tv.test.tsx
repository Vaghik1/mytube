// The player on a TV (remote control, no touch screen).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Must happen before the app code loads: this "device" has no touch screen.
vi.hoisted(() => {
  delete (window as any).ontouchstart;
});

import { loadSettings } from '../src/config';
import { Watch } from '../src/pages/Watch';
import { handleBack, initTV, isTouch } from '../src/tv';
import { installFakePlayer, liveRoutes } from './screens-fixtures';
import { mockYouTube, signIn } from './youtube-mock';

let stopTV: () => void;
beforeEach(() => {
  signIn();
  stopTV = initTV();
  mockYouTube(liveRoutes(), { '/api/picks': () => ({ picks: [] }) });
});
afterEach(() => {
  stopTV();
  cleanup();
  delete (window as any).YT;
});

const openPlayer = () =>
  render(
    <MemoryRouter initialEntries={['/watch/live1']}>
      <Routes>
        <Route path="/watch/:id" element={<Watch />} />
      </Routes>
    </MemoryRouter>,
  );
const key = (k: string) => act(() => void fireEvent.keyDown(document, { key: k }));

describe('player on a TV', () => {
  it('runs in remote-control mode', () => expect(isTouch).toBe(false));

  it('hides YouTube controls (the remote drives our own) and shows hints', async () => {
    const players = installFakePlayer();
    openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    expect(players[0].opts.playerVars.controls).toBe(0);
    expect(await screen.findByText(/OK play\/pause/)).toBeTruthy();
    expect(screen.queryByText('← Back')).toBeNull();
  });

  it('OK pauses and plays, ◀ ▶ jump 10 seconds', async () => {
    const players = installFakePlayer();
    openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    key('Enter');
    key('Enter');
    key('ArrowRight');
    key('ArrowLeft');
    expect(players[0].calls).toEqual(expect.arrayContaining(['pause', 'play', 'seek:110', 'seek:100']));
  });

  it('▼ opens details; Back closes them; Back again leaves the player', async () => {
    const players = installFakePlayer();
    openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    expect(screen.queryByText('Not interested')).toBeNull();
    key('ArrowDown');
    expect(await screen.findByText('Not interested')).toBeTruthy();
    expect(screen.getByText('▲ Back to video')).toBeTruthy();
    let handled = false;
    act(() => void (handled = handleBack()));
    expect(handled).toBe(true);
    await waitFor(() => expect(screen.queryByText('Not interested')).toBeNull());
  });

  it('subtitles are off by default, even when YouTube brings back ones a list preview turned on', async () => {
    const players = installFakePlayer();
    openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    act(() => players[0].emit(1));
    act(() => players[0].youtubeTurnsSubtitlesOn());
    expect(players[0].subtitles).toBeUndefined();
  });

  it('a Subtitles button in ▼ details turns them on and off, and the choice sticks for the next video', async () => {
    const players = installFakePlayer();
    const view = openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    act(() => players[0].emit(1));
    key('ArrowDown');
    fireEvent.click(await screen.findByText('Subtitles: Off'));
    expect(players[0].subtitles).toBe('en');
    expect(screen.getByText('Subtitles: On')).toBeTruthy();
    expect(loadSettings().subtitles).toBe(true);
    view.unmount();

    // Next video: on from the start, in the remembered language (English).
    openPlayer();
    await waitFor(() => expect(players).toHaveLength(2));
    expect(players[1].opts.playerVars.cc_load_policy).toBe(1);
    act(() => players[1].emit(1));
    expect(players[1].subtitles).toBe('en');
    key('ArrowDown');
    fireEvent.click(await screen.findByText('Subtitles: On'));
    expect(players[1].subtitles).toBeUndefined();
    expect(loadSettings().subtitles).toBe(false);
  });

  it("the remote's CC key toggles subtitles too", async () => {
    const players = installFakePlayer();
    openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    act(() => players[0].emit(1));
    key('ClosedCaptionToggle');
    expect(players[0].subtitles).toBe('en');
    expect(await screen.findByText('Subtitles on')).toBeTruthy();
  });

  it('records how long you watched when you leave', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const players = installFakePlayer();
    const view = openPlayer();
    await waitFor(() => expect(players).toHaveLength(1));
    await screen.findByText(/OK play\/pause/); // video details loaded
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    view.unmount();
    const history = JSON.parse(localStorage.getItem('mytube.history') || '[]');
    expect(history[0]?.id).toBe('live1');
    expect(history[0].sec).toBeGreaterThanOrEqual(15);
    vi.useRealTimers();
  });
});
