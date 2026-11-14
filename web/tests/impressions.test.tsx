import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../src/api';
import { VideoGrid, IMPRESSION_MS } from '../src/components/VideoGrid';
import { startedWatching } from '../src/history';
import { _newSession, demoteIgnored, FREE_SESSIONS, MAX_SHIFT, recordImpression, shiftFor } from '../src/impressions';

const vs = (...ids: string[]) => ids.map((id) => ({ id }));
const passOver = (id: string, sessions: number) => {
  for (let i = 0; i < sessions; i++) {
    _newSession();
    recordImpression(id);
  }
};

beforeEach(() => _newSession());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('videos you keep scrolling past drift down gently', () => {
  it('a couple of times means nothing', () => {
    passOver('a', FREE_SESSIONS);
    expect(shiftFor('a')).toBe(0);
    expect(demoteIgnored(vs('a', 'b', 'c')).map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });

  it('counts once per app session, not every time the list reloads', () => {
    _newSession();
    recordImpression('a');
    recordImpression('a');
    recordImpression('a');
    expect(shiftFor('a')).toBe(0);
    passOver('a', FREE_SESSIONS); // now 3 sessions in total
    expect(shiftFor('a')).toBeGreaterThan(0);
  });

  it('moves down only a few places, never hidden, never to the bottom of a long list', () => {
    passOver('a', 50);
    expect(shiftFor('a')).toBe(MAX_SHIFT);
    const list = vs('a', ...Array.from({ length: 30 }, (_, i) => `x${i}`));
    const out = demoteIgnored(list).map((v) => v.id);
    expect(out).toHaveLength(31);
    expect(out.indexOf('a')).toBe(MAX_SHIFT);
  });

  it('opening the video resets it, and the hint fades after a week', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    passOver('a', 6);
    expect(shiftFor('a')).toBeGreaterThan(0);
    startedWatching({ id: 'a', title: 't', channelId: 'c', channelTitle: 'C', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false } as Video);
    expect(shiftFor('a')).toBe(0);
    passOver('b', 6);
    vi.setSystemTime(Date.now() + 8 * 86400_000);
    expect(shiftFor('b')).toBe(0);
  });

  it('a For you card counts after a second on screen', () => {
    vi.useFakeTimers();
    const observed: Element[] = [];
    let cb: (e: { target: Element; isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(f: typeof cb) { cb = f; }
        observe(el: Element) { observed.push(el); }
        disconnect() {}
      },
    );
    const video = (id: string) => ({ id, title: id, channelId: 'c', channelTitle: 'C', publishedAt: new Date().toISOString(), thumb: '', duration: 600, views: 1, likes: 0, live: false }) as Video;
    render(
      <MemoryRouter>
        <VideoGrid videos={[video('seen'), video('flash')]} trackImpressions />
      </MemoryRouter>,
    );
    expect(observed).toHaveLength(2);
    act(() => cb([{ target: observed[0], isIntersecting: true }, { target: observed[1], isIntersecting: true }]));
    vi.advanceTimersByTime(IMPRESSION_MS / 2);
    act(() => cb([{ target: observed[1], isIntersecting: false }])); // scrolled away quickly
    vi.advanceTimersByTime(IMPRESSION_MS);
    passOver('seen', FREE_SESSIONS); // + this session = 3
    passOver('flash', FREE_SESSIONS);
    expect(shiftFor('seen')).toBeGreaterThan(0);
    expect(shiftFor('flash')).toBe(0);
  });
});
