// TV: a long, cut-off title on the card the remote rests on scrolls so you can read all of it.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  delete (window as any).ontouchstart;
});

import type { Video } from '../src/api';
import { MARQUEE_DELAY_MS, VideoCard } from '../src/components/VideoCard';
import { loadSettings, saveSettings } from '../src/config';

const video: Video = {
  id: 'v1', title: 'A very long title that does not fit in two lines of a card on the TV screen at all',
  channelId: 'c', channelTitle: 'Chan', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false,
};

/** jsdom has no layout: pretend the title is cut off (or not) and 300px wider than its box. */
function layout(cutOff: boolean) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('card-title') && cutOff ? 90 : 40;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
}

const show = () =>
  render(
    <MemoryRouter>
      <VideoCard v={video} />
    </MemoryRouter>,
  );
const title = () => document.querySelector<HTMLElement>('.card-title')!;
const span = () => title().querySelector('span')!;

beforeEach(() => {
  vi.useFakeTimers();
  saveSettings({ ...loadSettings(), betterTitles: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('long titles on the TV', () => {
  it('start scrolling after the remote rests on the card for a moment', () => {
    layout(true);
    show();
    fireEvent.focus(document.querySelector('.card')!);
    act(() => vi.advanceTimersByTime(MARQUEE_DELAY_MS - 100));
    expect(title().classList.contains('marquee')).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    expect(title().classList.contains('marquee')).toBe(true);
    expect(span().classList.contains('scrolling')).toBe(true);
    expect(span().style.getPropertyValue('--shift')).toBe('300px'); // slides until the end is visible
  });

  it('stop and go back to two lines when you move on', () => {
    layout(true);
    show();
    const card = document.querySelector('.card')!;
    fireEvent.focus(card);
    act(() => vi.advanceTimersByTime(MARQUEE_DELAY_MS + 50));
    fireEvent.blur(card);
    expect(title().classList.contains('marquee')).toBe(false);
    expect(span().classList.contains('scrolling')).toBe(false);
  });

  it('passing over a card quickly does not start it', () => {
    layout(true);
    show();
    const card = document.querySelector('.card')!;
    fireEvent.focus(card);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.blur(card);
    act(() => vi.advanceTimersByTime(MARQUEE_DELAY_MS));
    expect(title().classList.contains('marquee')).toBe(false);
  });

  it('a title that fits is left alone', () => {
    layout(false);
    show();
    fireEvent.focus(document.querySelector('.card')!);
    act(() => vi.advanceTimersByTime(MARQUEE_DELAY_MS + 50));
    expect(title().classList.contains('marquee')).toBe(false);
  });
});
