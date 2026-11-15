// Remote-control navigation (TV) and touch detection (phones).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TV = typeof import('../src/tv');

/** Loads tv.ts fresh, as a TV (no touch screen) or as a phone. */
async function loadTv(device: 'tv' | 'phone' | 'tv-app' | 'phone-app'): Promise<TV> {
  vi.resetModules();
  const w = window as any;
  if (device === 'phone' || device === 'phone-app') w.ontouchstart = null;
  else delete w.ontouchstart;
  delete w.MyTubeAndroid;
  if (device === 'tv-app') w.MyTubeAndroid = { openInYouTube: vi.fn(), exitApp: vi.fn(), isTv: () => true };
  if (device === 'phone-app') w.MyTubeAndroid = { openInYouTube: vi.fn(), exitApp: vi.fn(), isTv: () => false };
  return import('../src/tv');
}

/** Places focusable boxes at fixed screen positions (jsdom has no layout). */
function box(id: string, x: number, y: number, w = 100, h = 60, parent: HTMLElement = document.body) {
  const el = document.createElement('button');
  el.id = id;
  el.className = 'focusable';
  el.getBoundingClientRect = () =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} }) as DOMRect;
  el.scrollIntoView = vi.fn();
  parent.appendChild(el);
  return el;
}

const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const focused = () => (document.activeElement as HTMLElement)?.id;

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  delete (window as any).MyTubeAndroid;
  (window as any).ontouchstart = null;
});

describe('device detection', () => {
  it('a browser without touch is treated like a TV', async () => {
    const tv = await loadTv('tv');
    expect(tv.isTouch).toBe(false);
  });
  it('a phone browser uses touch mode', async () => {
    const tv = await loadTv('phone');
    expect(tv.isTouch).toBe(true);
    expect(tv.isTVApp).toBe(false);
  });
  it('the app on Google TV uses remote mode', async () => {
    const tv = await loadTv('tv-app');
    expect(tv.isTVApp).toBe(true);
    expect(tv.isTouch).toBe(false);
  });
  it('the same app on a phone uses touch mode', async () => {
    const tv = await loadTv('phone-app');
    expect(tv.isTVApp).toBe(false);
    expect(tv.isTouch).toBe(true);
  });
});

describe('remote control navigation (grid)', () => {
  let tv: TV;
  // A 3×2 grid of cards plus a sidebar on the left:
  //   [nav]  [a][b][c]
  //          [d][e][f]
  beforeEach(async () => {
    tv = await loadTv('tv');
    cleanup = tv.initTV();
    box('nav', 0, 0, 80, 60);
    const main = document.createElement('main');
    document.body.appendChild(main);
    const grid = document.createElement('div');
    grid.className = 'grid';
    main.appendChild(grid);
    box('a', 200, 0, 100, 60, grid);
    box('b', 320, 0, 100, 60, grid);
    box('c', 440, 0, 100, 60, grid);
    box('d', 200, 100, 100, 60, grid);
    box('e', 320, 100, 100, 60, grid);
    box('f', 440, 100, 100, 60, grid);
  });

  it('focuses the first card in the main area when nothing is focused', () => {
    press('ArrowRight');
    expect(focused()).toBe('a');
  });

  it('moves right, down, left and up between neighbours', () => {
    document.getElementById('a')!.focus();
    press('ArrowRight');
    expect(focused()).toBe('b');
    press('ArrowDown');
    expect(focused()).toBe('e');
    press('ArrowLeft');
    expect(focused()).toBe('d');
    press('ArrowUp');
    expect(focused()).toBe('a');
  });

  it('reaches the side menu from the first column, and comes back', () => {
    document.getElementById('a')!.focus();
    press('ArrowLeft');
    expect(focused()).toBe('nav');
    press('ArrowRight');
    expect(focused()).toBe('a');
  });

  it('setting up twice does not double every key press', () => {
    cleanup = tv.initTV();
    document.getElementById('a')!.focus();
    press('ArrowRight');
    expect(focused()).toBe('b');
  });

  it('Right at the end of a row goes to the first card of the next row', () => {
    document.getElementById('c')!.focus();
    press('ArrowRight');
    expect(focused()).toBe('d');
  });

  it('Left at the start of a row goes to the last card of the row above', () => {
    document.getElementById('d')!.focus();
    press('ArrowLeft');
    expect(focused()).toBe('c');
  });

  it('stays put at the end of the last row', () => {
    document.getElementById('f')!.focus();
    press('ArrowRight');
    expect(focused()).toBe('f');
  });

  it('OK on a non-button card clicks it', () => {
    const div = document.createElement('div');
    div.className = 'focusable';
    div.tabIndex = 0;
    const onClick = vi.fn();
    div.addEventListener('click', onClick);
    document.body.appendChild(div);
    div.focus();
    press('Enter');
    expect(onClick).toHaveBeenCalled();
  });

  it('lets a page take over keys (the video player)', () => {
    const handler = vi.fn(() => true);
    const off = tv.pushKeyHandler(handler);
    document.getElementById('a')!.focus();
    press('ArrowRight');
    expect(handler).toHaveBeenCalled();
    expect(focused()).toBe('a'); // the player handled it, focus did not move
    off();
    press('ArrowRight');
    expect(focused()).toBe('b');
  });

  it('keeps arrow keys inside a text box while typing', () => {
    const input = document.createElement('input');
    input.className = 'focusable';
    input.value = 'chess';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(2, 2);
    press('ArrowLeft');
    expect(document.activeElement).toBe(input);
  });
});

describe('Back button', () => {
  it('asks page handlers first (e.g. close the details panel)', async () => {
    const tv = await loadTv('tv');
    const h = vi.fn(() => true);
    const off = tv.pushBackHandler(h);
    expect(tv.handleBack()).toBe(true);
    expect(h).toHaveBeenCalled();
    off();
  });

  it('goes back through MyTube pages when not on Home', async () => {
    const tv = await loadTv('tv');
    history.pushState({ idx: 1 }, '', '/settings');
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    expect(tv.handleBack()).toBe(true);
    expect(back).toHaveBeenCalled();
    back.mockRestore();
    history.replaceState(null, '', '/');
  });

  it("never goes back into history from outside the app (that showed a black screen): goes Home instead", async () => {
    const tv = await loadTv('tv');
    history.replaceState(null, '', '/watch/abc'); // opened straight on a video, older entries aren't ours
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    expect(tv.handleBack()).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/');
    back.mockRestore();
  });

  it('on Home, closes the app itself', async () => {
    const tv = await loadTv('tv-app');
    history.replaceState(null, '', '/');
    expect(tv.handleBack()).toBe(true);
    expect((window as any).MyTubeAndroid.exitApp).toHaveBeenCalled();
    delete (window as any).MyTubeAndroid;
  });

  it('in a browser (no app), Home returns false', async () => {
    const tv = await loadTv('tv');
    history.replaceState(null, '', '/');
    expect(tv.handleBack()).toBe(false);
  });
});

describe('touch mode', () => {
  it('marks the page as touch and never steals focus or scrolls', async () => {
    const tv = await loadTv('phone');
    cleanup = tv.initTV();
    expect(document.documentElement.classList.contains('touch')).toBe(true);
    const el = box('x', 0, 0);
    tv.focusEl(el);
    expect(document.activeElement).not.toBe(el);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens videos in the YouTube app when available', async () => {
    const tv = await loadTv('tv-app');
    tv.openInYouTube('abc');
    expect((window as any).MyTubeAndroid.openInYouTube).toHaveBeenCalledWith('abc');
  });
});
