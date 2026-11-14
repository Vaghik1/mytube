// Muted previews while browsing — phone behaviour (touch). TV is in preview-tv.test.tsx.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../src/api';
import { Preview, REVEAL_AFTER_MS } from '../src/components/Preview';
import { seenIds, startPoint } from '../src/history';
import { VideoCard } from '../src/components/VideoCard';
import { defaultSettings, saveSettings } from '../src/config';
import { SCROLL_IDLE_MS, getPreview, pickPreviewCard, setPreview, startPreviews } from '../src/preview';
import { isTouch } from '../src/tv';
import { installFakePlayer } from './screens-fixtures';

const VH = 800;
/** A card at a given vertical position (jsdom has no layout). */
function card(id: string, top: number, height = 200) {
  const el = document.createElement('button');
  el.dataset.videoId = id;
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  thumb.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} }) as DOMRect;
  el.appendChild(thumb);
  document.body.appendChild(el);
  return el;
}
const scroll = () => document.dispatchEvent(new Event('scroll'));

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('innerHeight', VH);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
  vi.useRealTimers();
  setPreview(null);
  delete (window as any).YT;
  delete (navigator as any).connection;
});

describe('choosing what to preview on a phone', () => {
  it('runs in touch mode', () => expect(isTouch).toBe(true));

  /** The page scrolls inside <main>: pretend it is scrolled to `y` of `max`. */
  function scrolledTo(y: number, max = 2000) {
    const main = document.createElement('main');
    Object.defineProperty(main, 'scrollTop', { value: y, configurable: true });
    Object.defineProperty(main, 'scrollHeight', { value: max + VH, configurable: true });
    Object.defineProperty(main, 'clientHeight', { value: VH, configurable: true });
    document.body.appendChild(main);
  }

  it('at the top of a list, the first video plays (it can never reach the middle)', () => {
    scrolledTo(0);
    card('top', 0);
    card('middle', 300);
    card('cut-off', 700); // only 100 of 200px visible
    expect(pickPreviewCard()).toBe('top');
  });

  it('once scrolled, the fully visible card nearest the middle of the screen plays', () => {
    scrolledTo(500);
    card('top', 0);
    card('middle', 300);
    card('cut-off', 700);
    expect(pickPreviewCard()).toBe('middle');
  });

  it('at the very bottom, the last video plays', () => {
    scrolledTo(2000, 2000);
    card('a', 100);
    card('middle', 300);
    card('last', 580);
    expect(pickPreviewCard()).toBe('last');
  });

  it('skips a card that is mostly scrolled off the top', () => {
    scrolledTo(0);
    card('gone', -150); // only 50 of 200px visible
    card('next', 100);
    expect(pickPreviewCard()).toBe('next');
  });

  it("does not count what's hidden under the top bar or the tab bar", () => {
    const rect = (top: number, height: number) => () =>
      ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} }) as DOMRect;
    const bar = document.createElement('header');
    bar.className = 'topbar';
    bar.getBoundingClientRect = rect(0, 100);
    const tabs = document.createElement('nav');
    tabs.className = 'sidebar';
    tabs.getBoundingClientRect = rect(VH - 80, 80);
    document.body.append(bar, tabs);
    document.body.prepend(Object.assign(document.createElement('main')));
    card('under-bar', 0); // half under the top bar
    card('ok', 320);
    card('under-tabs', 600); // bottom 80px under the tab bar
    expect(pickPreviewCard()).toBe('ok');
    bar.classList.add('hidden'); // top bar slid away: the first card is fully visible again
    expect(pickPreviewCard()).toBe('under-bar');
  });

  it('waits until scrolling stops, and stops the preview while scrolling', () => {
    card('a', 300);
    stop = startPreviews();
    scroll();
    vi.advanceTimersByTime(SCROLL_IDLE_MS - 100);
    expect(getPreview()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(getPreview()).toBe('a');
    scroll(); // you start scrolling again
    expect(getPreview()).toBeNull();
  });

  it('previews the first video when a list appears, without scrolling', async () => {
    stop = startPreviews();
    card('first', 200);
    await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS + 50); // MutationObserver + idle wait
    expect(getPreview()).toBe('first');
  });

  it('does nothing when previews are turned off in Settings', () => {
    saveSettings({ ...defaultSettings, previewOnBrowse: false });
    card('a', 300);
    stop = startPreviews();
    scroll();
    vi.advanceTimersByTime(SCROLL_IDLE_MS + 50);
    expect(getPreview()).toBeNull();
  });

  it("does nothing when the phone's data saver is on", () => {
    (navigator as any).connection = { saveData: true };
    card('a', 300);
    stop = startPreviews();
    scroll();
    vi.advanceTimersByTime(SCROLL_IDLE_MS + 50);
    expect(getPreview()).toBeNull();
  });

  it('stopping (e.g. opening a video) ends any preview', () => {
    card('a', 300);
    stop = startPreviews();
    scroll();
    vi.advanceTimersByTime(SCROLL_IDLE_MS + 50);
    stop();
    stop = undefined;
    expect(getPreview()).toBeNull();
  });
});

describe('the preview player', () => {
  const video: Video = {
    id: 'v1', title: 'Chess', channelId: 'c', channelTitle: 'C', publishedAt: new Date().toISOString(),
    thumb: '', duration: 300, views: 1, likes: 0, live: false, description: '',
  };

  it('only the chosen card shows a preview, over its thumbnail', () => {
    installFakePlayer();
    const { container } = render(
      <MemoryRouter>
        <VideoCard v={video} />
        <VideoCard v={{ ...video, id: 'v2' }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.preview')).toBeNull();
    act(() => setPreview('v2'));
    const previews = container.querySelectorAll('.preview');
    expect(previews).toHaveLength(1);
    expect(previews[0].closest('[data-video-id]')!.getAttribute('data-video-id')).toBe('v2');
    expect(previews[0].closest('.thumb')).toBeTruthy();
  });

  it('plays muted, without controls, and stays hidden until it is really playing', async () => {
    const players = installFakePlayer();
    const { container } = render(<Preview id="v1" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const p = players[0];
    expect(p.opts.playerVars).toMatchObject({ mute: 1, controls: 0, autoplay: 1, playsinline: 1, cc_load_policy: 1 });
    expect(p.calls).toContain('mute');
    expect(container.querySelector('.preview')!.className).not.toContain('playing');
    act(() => p.emit(1));
    // YouTube's start-up title / big pause button are still on screen: keep the thumbnail.
    await act(async () => void (await vi.advanceTimersByTimeAsync(REVEAL_AFTER_MS - 100)));
    expect(container.querySelector('.preview')!.className).not.toContain('playing');
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(container.querySelector('.preview')!.className).toContain('playing');
  });

  it('counts only time spent playing: a buffering pause delays it but does not start the wait over', async () => {
    const players = installFakePlayer();
    const { container } = render(<Preview id="v1" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const p = players[0];
    act(() => p.emit(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    act(() => p.emit(3)); // buffering for 2 seconds
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
    expect(container.querySelector('.preview')!.className).not.toContain('playing');
    act(() => p.emit(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(REVEAL_AFTER_MS - 1500 + 300)));
    expect(container.querySelector('.preview')!.className).toContain('playing');
  });

  it("asks YouTube to play again if it doesn't start by itself", async () => {
    const players = installFakePlayer();
    render(<Preview id="v1" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const p = players[0];
    act(() => p.emit(-1)); // unstarted
    const before = p.calls.filter((c) => c === 'play').length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    expect(p.calls.filter((c) => c === 'play').length).toBeGreaterThan(before);
  });

  it('turns English subtitles on when it starts playing', async () => {
    const players = installFakePlayer();
    render(<Preview id="v1" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const p = players[0] as any;
    const opts: unknown[] = [];
    p.setOption = (...a: unknown[]) => opts.push(a);
    act(() => p.emit(1));
    expect(opts).toContainEqual(['captions', 'track', { languageCode: 'en' }]);
  });

  it('disappears if the video cannot be embedded, or when it ends', async () => {
    const players = installFakePlayer();
    const a = render(<Preview id="blocked" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    act(() => players[0].fail(150));
    expect(a.container.querySelector('.preview')).toBeNull();

    const b = render(<Preview id="short" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    act(() => players[1].emit(1));
    act(() => players[1].emit(0));
    expect(b.container.querySelector('.preview')).toBeNull();
  });

  it('keeps playing (no time limit) and remembers where it got to when you move on', async () => {
    const players = installFakePlayer();
    const view = render(<Preview id="long" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const p = players[0];
    act(() => p.emit(1));
    p.time = 50;
    await act(async () => void (await vi.advanceTimersByTimeAsync(5 * 60_000))); // five minutes
    expect(p.calls).not.toContain('stop');
    expect(view.container.querySelector('.preview')).not.toBeNull();
    p.time = 312;
    view.unmount(); // scrolled away
    expect(p.destroyed).toBe(true);
    expect(startPoint('long')).toEqual({ pos: 312, dur: 600 });
    // …and it isn't "watched": it still shows up in suggestions
    expect(seenIds().has('long')).toBe(false);
  });

  it('the next preview of the same video continues from there', async () => {
    const players = installFakePlayer();
    const a = render(<Preview id="again" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    act(() => players[0].emit(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    players[0].time = 140;
    a.unmount();
    render(<Preview id="again" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(players[1].opts.playerVars.start).toBe(140);
  });

  it('played to the end: forgets the spot, so it starts fresh next time', async () => {
    const players = installFakePlayer();
    const v = render(<Preview id="short" />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    act(() => players[0].emit(1));
    players[0].time = 30;
    await act(async () => void (await vi.advanceTimersByTimeAsync(2500)));
    act(() => players[0].emit(0));
    v.unmount();
    expect(startPoint('short')).toBeNull();
  });
});

describe('red progress bar on thumbnails', () => {
  const base: Video = {
    id: 'r1', title: 'Chess', channelId: 'c', channelTitle: 'C', publishedAt: new Date().toISOString(),
    thumb: '', duration: 1000, views: 1, likes: 0, live: false, description: '',
  };
  it('shows how far you got in a video you have not finished, and nothing otherwise', async () => {
    const { recordWatch } = await import('../src/history');
    recordWatch(base, 300, 250);
    const { container } = render(
      <MemoryRouter>
        <VideoCard v={base} />
        <VideoCard v={{ ...base, id: 'fresh' }} />
      </MemoryRouter>,
    );
    const bars = container.querySelectorAll('.resume-bar > span');
    expect(bars).toHaveLength(1);
    expect((bars[0] as HTMLElement).style.width).toBe('25%');
  });
});

describe('enlarged preview on the phone', () => {
  const base: Video = {
    id: 'z1', title: 'Chess', channelId: 'c', channelTitle: 'C', publishedAt: new Date().toISOString(),
    thumb: '', duration: 600, views: 1, likes: 0, live: false, description: '',
  };
  const mount = () => {
    installFakePlayer();
    return render(
      <MemoryRouter>
        <VideoCard v={base} />
      </MemoryRouter>,
    );
  };
  const reveal = async () => {
    act(() => setPreview('z1'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(REVEAL_AFTER_MS + 300)));
  };

  it('moves to the middle of the screen, as wide as it fits', async () => {
    const { zoomTransform } = await import('../src/components/VideoCard');
    // a 360×202 thumbnail at the top of a 390×844 phone screen
    expect(zoomTransform({ left: 15, top: 60, width: 360, height: 202 }, 390, 844)).toBe('translate(0px, 261px) scale(1.083)');
  });

  it('once the preview is playing, it is enlarged and everything else is dimmed', async () => {
    const { container } = mount();
    await reveal();
    expect(container.querySelector('.thumb')!.className).toContain('zoomed');
    expect(document.querySelector('.zoom-backdrop')).toBeTruthy();
  });

  it('tapping outside closes it (without opening the video) and it stays small after that', async () => {
    const { container } = mount();
    await reveal();
    fireEvent.click(document.querySelector('.zoom-backdrop')!);
    expect(document.querySelector('.zoom-backdrop')).toBeNull();
    expect(container.querySelector('.thumb')!.className).not.toContain('zoomed');
    expect(container.querySelector('.preview')).toBeTruthy(); // still playing, small
  });

  it('a swipe outside closes it too', async () => {
    mount();
    await reveal();
    fireEvent.touchMove(document.querySelector('.zoom-backdrop')!);
    expect(document.querySelector('.zoom-backdrop')).toBeNull();
  });

  it('can be turned off in Settings', async () => {
    saveSettings({ ...defaultSettings, zoomPreviews: false });
    const { container } = mount();
    await reveal();
    expect(container.querySelector('.preview')).toBeTruthy();
    expect(document.querySelector('.zoom-backdrop')).toBeNull();
  });
});
