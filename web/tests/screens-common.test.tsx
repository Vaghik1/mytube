// Screens that look the same on TV and phone.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../src/api';
import { Sidebar } from '../src/components/Sidebar';
import { VideoCard } from '../src/components/VideoCard';
import { loadRemotePrefs, loadSettings, saveRemotePrefs } from '../src/config';
import { recordWatch } from '../src/history';
import { Login } from '../src/pages/Login';
import { Settings } from '../src/pages/Settings';
import { mockYouTube, signIn } from './youtube-mock';

afterEach(() => cleanup());

const video = (over: Partial<Video> = {}): Video => ({
  id: 'v1',
  title: 'Chess blitz',
  channelId: 'c',
  channelTitle: 'Chess Channel',
  publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  thumb: 'https://i.ytimg.com/vi/v1/mqdefault.jpg',
  duration: 271,
  views: 1500,
  likes: 0,
  live: false,
  description: '',
  ...over,
});

const inRouter = (ui: React.ReactNode, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('Sidebar / tab bar', () => {
  it('has the five destinations with labels, and no Trending/category tab', () => {
    mockYouTube({ channels: () => ({ items: [] }) });
    inRouter(<Sidebar />);
    for (const label of ['Search', 'Home', 'Subscriptions', 'Library', 'Settings'])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Trending')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('marks the current page', () => {
    mockYouTube({ channels: () => ({ items: [] }) });
    inRouter(<Sidebar />, '/library');
    expect(screen.getByText('Library').closest('a')!.className).toContain('active');
    expect(screen.getByText('Home').closest('a')!.className).not.toContain('active');
  });
});

describe('VideoCard', () => {
  it('shows duration, channel, views and age', () => {
    inRouter(<VideoCard v={video()} />);
    expect(screen.getByText('4:31')).toBeTruthy();
    expect(screen.getByText('Chess Channel')).toBeTruthy();
    expect(screen.getByText(/1\.5K views • 2 hours ago/)).toBeTruthy();
  });

  it('shows LIVE and viewers for live streams', () => {
    inRouter(<VideoCard v={video({ live: true, duration: 0, liveViewers: 138 })} />);
    expect(screen.getByText('● LIVE')).toBeTruthy();
    expect(screen.getByText('138 watching')).toBeTruthy();
  });

  it('shows the start time for upcoming streams, never LIVE', () => {
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    inRouter(<VideoCard v={video({ upcoming: true, duration: 0, scheduledStart: start })} />);
    expect(screen.queryByText('● LIVE')).toBeNull();
    expect(screen.getAllByText(/\d{2}[:.]\d{2}/).length).toBeGreaterThan(0);
  });

  it("shows ChatGPT's picks like any other video (no extra label)", () => {
    inRouter(<VideoCard v={video({ note: 'Great endgame technique' })} />);
    expect(screen.queryByText(/Great endgame technique/)).toBeNull();
    expect(screen.getByText('Chess blitz')).toBeTruthy();
  });
});

describe('Login', () => {
  it('shows the code to enter at google.com/device', async () => {
    mockYouTube(
      {},
      {
        '/api/auth/device': () => ({
          device_code: 'dc',
          user_code: 'ABC-DEF-GHI',
          verification_url: 'https://www.google.com/device',
          expires_in: 1800,
          interval: 5,
        }),
      },
    );
    render(<Login />);
    expect(await screen.findByText('ABC-DEF-GHI')).toBeTruthy();
    expect(screen.getByText('www.google.com/device')).toBeTruthy();
  });

  it('signs in once you approve on the phone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let approved = false;
    mockYouTube(
      {},
      {
        '/api/auth/device': () => ({ device_code: 'dc', user_code: 'X', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 1 }),
        '/api/auth/token': () => (approved ? { access_token: 'ya29.ok', refresh_token: 'r', expires_in: 3600 } : { error: 'authorization_pending' }),
      },
    );
    render(<Login />);
    await screen.findByText('X');
    approved = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await waitFor(() => expect(localStorage.getItem('mytube.tokens')).toContain('ya29.ok'));
    vi.useRealTimers();
  });

  it('explains a server problem and offers to retry', async () => {
    mockYouTube({}, { '/api/auth/device': () => new Response(JSON.stringify({ error_description: 'GOOGLE_CLIENT_ID not set' }), { status: 500 }) });
    render(<Login />);
    expect(await screen.findByText(/GOOGLE_CLIENT_ID not set/)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});

describe('Settings', () => {
  it('saves toggles', () => {
    signIn();
    inRouter(<Settings />);
    fireEvent.click(screen.getByText(/Hide Shorts: Off/));
    expect(loadSettings().hideShorts).toBe(true);
    expect(screen.getByText(/Hide Shorts: On/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Autoplay next: On/));
    expect(loadSettings().autoplayNext).toBe(false);
  });

  it("shows what ChatGPT set and can reset it", async () => {
    signIn();
    saveRemotePrefs({ interests: ['chess', 'physics'], dislikedTopics: ['celebrity gossip'], hideShorts: true });
    const f = mockYouTube({}, { '/api/picks': () => ({ preferences: {} }) });
    inRouter(<Settings />);
    expect(screen.getByText('Interests: chess, physics')).toBeTruthy();
    expect(screen.getByText('Hidden topics: celebrity gossip')).toBeTruthy();
    expect(screen.getByText(/Shorts: hidden/)).toBeTruthy();
    fireEvent.click(screen.getByText('Reset ChatGPT preferences'));
    await waitFor(() => expect(screen.queryByText(/Interests:/)).toBeNull());
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).action).toBe('reset_preferences');
    expect(loadRemotePrefs().interests).toEqual([]);
  });

  it('has no region / category settings any more', () => {
    inRouter(<Settings />);
    expect(screen.queryByText(/Region/)).toBeNull();
  });

  it('shows what MyTube has learned and can clear it', () => {
    for (const id of ['a', 'b', 'c'])
      recordWatch({ ...video({ id, channelId: 'chess', channelTitle: 'Chess Channel', title: 'Chess endgame' }), duration: 600 }, 500);
    inRouter(<Settings />);
    expect(screen.getByText(/3 videos watched/)).toBeTruthy();
    expect(screen.getByText(/Top channels: Chess Channel/)).toBeTruthy();
    fireEvent.click(screen.getByText('Clear watch history (TV and phone)'));
    expect(screen.getByText(/0 videos watched/)).toBeTruthy();
  });
});
