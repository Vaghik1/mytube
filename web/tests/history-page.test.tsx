import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notInterested, recordWatch } from '../src/history';
import { History, HISTORY_LIMIT, watchedVideos } from '../src/pages/History';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const video = (id: string) => ({ id, title: `Video ${id}`, channelId: 'c', channelTitle: 'Chan', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false, description: '' });

describe('History', () => {
  it('lists what you watched, newest first, without using YouTube quota', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    recordWatch(video('first'), 60, 60);
    vi.setSystemTime(Date.now() + 60_000);
    recordWatch(video('second'), 60, 60);
    notInterested(video('nope')); // never played: not history
    const list = watchedVideos();
    expect(list.map((v) => v.id)).toEqual(['second', 'first']);
    expect(list[0].thumb).toBe('https://i.ytimg.com/vi/second/hqdefault.jpg');
    expect(list[0].watchedAt).toBeGreaterThan(0);
  });

  it(`keeps only the last ${HISTORY_LIMIT}`, () => {
    const list = Array.from({ length: 700 }, (_, i) => ({ id: `v${i}`, ch: 'c', cht: 'C', title: 't', sec: 30, dur: 60, at: 1000 + i }));
    localStorage.setItem('mytube.history', JSON.stringify(list));
    const out = watchedVideos();
    expect(out).toHaveLength(HISTORY_LIMIT);
    expect(out[0].id).toBe('v699');
  });

  it('shows cards with "Watched …" and an empty message when there is nothing yet', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Videos you watch on your TV or phone show up here/)).toBeTruthy();
    unmount();
    recordWatch(video('w1'), 60, 60);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Watched/)).toBeTruthy());
    expect(screen.getByText('Video w1')).toBeTruthy();
  });
});
