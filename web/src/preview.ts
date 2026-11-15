// Decides which video plays a muted preview while you browse (like YouTube's home feed).
//  • Phone: when scrolling stops, the card nearest the middle of the screen (like YouTube).
//    At the very top of a list the first card can't reach the middle, so it plays instead
//    (and likewise the last card at the very bottom).
//  • TV: never (previews are a phone feature).
import { useSyncExternalStore } from 'react';
import { loadSettings } from './config';
import { isTouch } from './tv';
import { loadYTApi } from './yt';

export const SCROLL_IDLE_MS = 350;

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

/** Part of the screen not covered by the phone's top bar and bottom tab bar. */
function viewArea() {
  let top = 0;
  let bottom = window.innerHeight;
  const bar = document.querySelector<HTMLElement>('.topbar:not(.hidden)');
  const tabs = document.querySelector<HTMLElement>('.sidebar');
  const tb = bar?.getBoundingClientRect();
  if (tb && tb.height > 0 && tb.bottom > 0) top = Math.max(top, tb.bottom);
  const sb = tabs?.getBoundingClientRect();
  if (sb && sb.height > 0 && sb.top > top && sb.top < bottom) bottom = sb.top;
  return { top, bottom };
}

/** How far the list is scrolled: at the top, at the bottom, or in between. */
function scrollEdge(): 'top' | 'bottom' | null {
  const sc = document.querySelector<HTMLElement>('main') || (document.scrollingElement as HTMLElement | null);
  if (!sc) return 'top';
  if (sc.scrollTop <= 8) return 'top';
  const scrollable = sc.scrollHeight - sc.clientHeight;
  if (scrollable > 0 && scrollable - sc.scrollTop <= 8) return 'bottom';
  return null;
}

/** Which card should preview now (see the rules at the top of this file). */
export function pickPreviewCard(): string | null {
  const { top, bottom } = viewArea();
  const mid = (top + bottom) / 2;
  const edge = scrollEdge();
  let best: { id: string; score: number } | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-video-id]')) {
    const thumb = el.querySelector<HTMLElement>('.thumb') || el;
    const r = thumb.getBoundingClientRect();
    if (r.height === 0) continue;
    const visible = Math.min(r.bottom, bottom) - Math.max(r.top, top);
    if (visible < r.height * 0.75) continue;
    const score = edge === 'top' ? r.top : edge === 'bottom' ? -r.top : Math.abs((r.top + r.bottom) / 2 - mid);
    if (!best || score < best.score) best = { id: el.dataset.videoId!, score };
  }
  return best?.id ?? null;
}

/** Starts watching scrolling (phone only; TVs get no previews). Returns a function that stops it. */
export function startPreviews(): () => void {
  if (!isTouch) return () => setPreview(null);
  // Load YouTube's player code now, so the first preview starts without waiting for it.
  if (allowed()) void loadYTApi();
  let timer = 0;
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };

  const onScroll = () => {
    setPreview(null);
    later(() => allowed() && setPreview(pickPreviewCard()), SCROLL_IDLE_MS);
  };
  // The page scrolls inside <main>, so listen in the capture phase.
  document.addEventListener('scroll', onScroll, true);
  // Also preview something when a list first appears, without scrolling.
  const onLoad = () => later(() => allowed() && !active && setPreview(pickPreviewCard()), SCROLL_IDLE_MS);
  const mo = new MutationObserver(onLoad);
  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    document.removeEventListener('scroll', onScroll, true);
    mo.disconnect();
    window.clearTimeout(timer);
    setPreview(null);
  };
}
