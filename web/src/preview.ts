// Decides which video plays a muted preview while you browse (like YouTube's home feed).
//  • Phone: when scrolling stops, the card nearest the middle of the screen.
//  • TV: the card the remote has rested on for a moment.
import { useSyncExternalStore } from 'react';
import { loadSettings } from './config';
import { isTouch } from './tv';

export const SCROLL_IDLE_MS = 800;
export const FOCUS_DWELL_MS = 1500;

let active: string | null = null;
const listeners = new Set<() => void>();

export function setPreview(id: string | null) {
  if (active === id) return;
  active = id;
  listeners.forEach((l) => l());
}
export const getPreview = () => active;

/** True for the one card that should be previewing right now. */
export function usePreviewActive(id: string): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => active === id,
  );
}

function allowed(): boolean {
  if (!loadSettings().previewOnBrowse) return false;
  const conn = (navigator as any).connection;
  if (conn?.saveData) return false; // data saver on
  return true;
}

/** The card whose thumbnail is mostly visible and closest to the middle of the screen. */
export function pickCentered(): string | null {
  const vh = window.innerHeight;
  let best: { id: string; d: number } | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-video-id]')) {
    const thumb = el.querySelector<HTMLElement>('.thumb') || el;
    const r = thumb.getBoundingClientRect();
    if (r.height === 0) continue;
    const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (visible < r.height * 0.75) continue;
    const d = Math.abs((r.top + r.bottom) / 2 - vh / 2);
    if (!best || d < best.d) best = { id: el.dataset.videoId!, d };
  }
  return best?.id ?? null;
}

/** Starts watching scrolling (phone) or focus (TV). Returns a function that stops it. */
export function startPreviews(): () => void {
  let timer = 0;
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };

  if (isTouch) {
    const onScroll = () => {
      setPreview(null);
      later(() => allowed() && setPreview(pickCentered()), SCROLL_IDLE_MS);
    };
    // The page scrolls inside <main>, so listen in the capture phase.
    document.addEventListener('scroll', onScroll, true);
    // Also preview something when a list first appears, without scrolling.
    const onLoad = () => later(() => allowed() && !active && setPreview(pickCentered()), SCROLL_IDLE_MS);
    const mo = new MutationObserver(onLoad);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      mo.disconnect();
      window.clearTimeout(timer);
      setPreview(null);
    };
  }

  const onFocus = (e: FocusEvent) => {
    setPreview(null);
    const card = (e.target as HTMLElement)?.closest?.<HTMLElement>('[data-video-id]');
    if (!card) return window.clearTimeout(timer);
    later(() => allowed() && document.activeElement === card && setPreview(card.dataset.videoId!), FOCUS_DWELL_MS);
  };
  document.addEventListener('focusin', onFocus);
  return () => {
    document.removeEventListener('focusin', onFocus);
    window.clearTimeout(timer);
    setPreview(null);
  };
}
