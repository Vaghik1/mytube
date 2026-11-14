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
