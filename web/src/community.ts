// Free community data from the SponsorBlock project (sponsor.ajay.app), no YouTube quota used:
//  • SponsorBlock: where sponsor reads and similar segments are, so the player can skip them.
//  • DeArrow: community-written titles and thumbnails that replace clickbait.
// Lookups send only the first 4 characters of a hash of the video id, so the service
// can't tell which video you're watching. Data is licensed CC BY-NC-SA 4.0 (credited in Settings).
import { useEffect, useState } from 'react';
import type { Video } from './api';
import { loadSettings } from './config';

export const SB_API = 'https://sponsor.ajay.app';
export const DEARROW_THUMBS = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail';
/** What gets skipped: paid sponsor reads, unpaid self-promotion, and "like and subscribe" reminders. */
export const SKIP_CATEGORIES = ['sponsor', 'selfpromo', 'interaction'] as const;

export type Segment = { start: number; end: number; category: string; id: string };

async function hashPrefix(videoId: string): Promise<string> {
  const data = new TextEncoder().encode(videoId);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 4);
}

// ── small localStorage cache ──
const CACHE = 'mytube.sb.';
function cacheGet<T>(key: string, ttlMs: number): T | undefined {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE + key) || 'null');
    if (hit && Date.now() - hit.t < ttlMs) return hit.v as T;
  } catch {
    /* ignore */
  }
  return undefined;
}
function cacheSet(key: string, v: unknown) {
  try {
    localStorage.setItem(CACHE + key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    // Storage full: drop our old entries and carry on.
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE))
      .forEach((k) => localStorage.removeItem(k));
  }
}

// ── SponsorBlock ──

/** Segments to skip in a video (empty if none, if the service is down, or if skipping is off). */
export async function getSkipSegments(videoId: string): Promise<Segment[]> {
  if (!loadSettings().skipSponsors) return [];
  const cached = cacheGet<Segment[]>(`seg.${videoId}`, 6 * 3600_000);
  if (cached) return cached;
  try {
    const prefix = await hashPrefix(videoId);
    const q = `categories=${encodeURIComponent(JSON.stringify(SKIP_CATEGORIES))}&actionType=skip`;
    const r = await fetch(`${SB_API}/api/skipSegments/${prefix}?${q}`);
    let out: Segment[] = [];
    if (r.ok) {
      const list = (await r.json()) as { videoID: string; segments: { segment: [number, number]; category: string; UUID: string }[] }[];
      out = (list.find((x) => x.videoID === videoId)?.segments || [])
        .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category, id: s.UUID }))
        .filter((s) => s.end - s.start >= 1)
        .sort((a, b) => a.start - b.start);
    } else if (r.status !== 404) return []; // try again next time
    cacheSet(`seg.${videoId}`, out);
    return out;
  } catch {
    return [];
  }
}

/** The segment the player is in right now (and hasn't skipped yet), if any. */
export function segmentAt(segments: Segment[], time: number, skipped: Set<string>): Segment | undefined {
  return segments.find((s) => !skipped.has(s.id) && time >= s.start && time < s.end - 0.5);
}

export const CATEGORY_LABEL: Record<string, string> = {
  sponsor: 'Skipped sponsor',
  selfpromo: 'Skipped self-promotion',
  interaction: 'Skipped subscribe reminder',
};

// ── DeArrow ──

type Branding = { title?: string; thumbTime?: number };
type BrandingApi = {
  titles?: { title: string; original: boolean; votes: number; locked: boolean }[];
  thumbnails?: { timestamp: number | null; original: boolean; votes: number; locked: boolean }[];
};

/** DeArrow marks words to keep as written with a leading ">"; remove the markers. */
export function cleanTitle(t: string) {
  return t.replace(/(^|\s)>(?=\S)/g, '$1').trim();
}

/** Pick the community title/thumbnail the way DeArrow does: the top one, if trusted (locked or not voted down). */
export function chooseBranding(b: BrandingApi): Branding {
  const t = b.titles?.[0];
  const th = b.thumbnails?.[0];
  const trusted = (x: { votes: number; locked: boolean }) => x.locked || x.votes >= 0;
  return {
    title: t && !t.original && trusted(t) ? cleanTitle(t.title) : undefined,
    thumbTime: th && !th.original && th.timestamp != null && trusted(th) ? th.timestamp : undefined,
  };
}

const pending = new Map<string, Promise<Branding>>();
export async function getBranding(videoId: string): Promise<Branding> {
  const cached = cacheGet<Branding>(`br.${videoId}`, 3 * 86400_000);
  if (cached) return cached;
  let p = pending.get(videoId);
  if (!p) {
    p = fetch(`${SB_API}/api/branding?videoID=${encodeURIComponent(videoId)}`)
      .then(async (r) => {
        const b = r.ok ? chooseBranding((await r.json()) as BrandingApi) : r.status === 404 ? {} : null;
        if (b) cacheSet(`br.${videoId}`, b);
        return b || {};
      })
      .catch(() => ({}))
      .finally(() => pending.delete(videoId));
    pending.set(videoId, p);
  }
  return p;
}

/** Title and thumbnail to show for a video: DeArrow's when available (and turned on), else YouTube's. */
export function useBranding(v: Video): { title: string; thumb: string; fallbackThumb: string } {
  const on = !v.live && loadSettings().betterTitles;
  const [b, setB] = useState<Branding>(() => (on ? cacheGet<Branding>(`br.${v.id}`, 3 * 86400_000) || {} : {}));
  useEffect(() => {
    if (!on) return;
    let alive = true;
    getBranding(v.id).then((x) => alive && setB(x));
    return () => {
      alive = false;
    };
  }, [v.id, on]);
  return {
    title: b.title || v.title,
    thumb: b.thumbTime !== undefined ? `${DEARROW_THUMBS}?videoID=${v.id}&time=${b.thumbTime}` : v.thumb,
    fallbackThumb: v.thumb,
  };
}
