// Muted previews are a phone feature: a TV never plays them, wherever the remote rests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  delete (window as any).ontouchstart;
});

import { getPreview, setPreview, startPreviews } from '../src/preview';
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

  it('never previews the video the remote rests on', () => {
    card('a').focus();
    vi.advanceTimersByTime(10_000);
    expect(getPreview()).toBeNull();
  });
});
