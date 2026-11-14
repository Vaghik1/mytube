// Muted previews on a TV: the video the remote rests on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  delete (window as any).ontouchstart;
});

import { FOCUS_DWELL_MS, getPreview, setPreview, startPreviews } from '../src/preview';
import { isTouch } from '../src/tv';

function card(id: string) {
  const el = document.createElement('button');
  el.dataset.videoId = id;
  document.body.appendChild(el);
  return el;
}

let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  stop = startPreviews();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  setPreview(null);
});

describe('previews on a TV', () => {
  it('runs in remote mode', () => expect(isTouch).toBe(false));

  it('previews the video the remote rests on', () => {
    card('a').focus();
    vi.advanceTimersByTime(FOCUS_DWELL_MS - 100);
    expect(getPreview()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(getPreview()).toBe('a');
  });

  it('moving on quickly does not start previews for each video passed', () => {
    card('a').focus();
    vi.advanceTimersByTime(500);
    card('b').focus();
    vi.advanceTimersByTime(500);
    const c = card('c');
    c.focus();
    vi.advanceTimersByTime(FOCUS_DWELL_MS + 50);
    expect(getPreview()).toBe('c');
  });

  it('moving to the menu stops the preview', () => {
    card('a').focus();
    vi.advanceTimersByTime(FOCUS_DWELL_MS + 50);
    const menu = document.createElement('button');
    document.body.appendChild(menu);
    menu.focus();
    expect(getPreview()).toBeNull();
    vi.advanceTimersByTime(FOCUS_DWELL_MS + 50);
    expect(getPreview()).toBeNull();
  });
});
