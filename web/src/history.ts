// Your personal watch history, kept on this device, and the taste profile learned from it.
// Everything here updates automatically as you watch; nothing is sent anywhere except
// the YouTube searches built from your top topics.
import type { Video } from './api';

export type Watch = {
  id: string;
  ch: string; // channel id
  cht: string; // channel title
  title: string;
  cat?: string; // YouTube category id
  tags?: string[];
  sec: number; // seconds actually watched
  dur: number; // video length in seconds
  at: number; // last watched (ms)
  liked?: boolean;
  skip?: boolean; // "Not interested"
};

const KEY = 'mytube.history';
const MAX = 800;
const HALF_LIFE_DAYS = 14;

export function loadHistory(): Watch[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function save(list: Watch[]) {
  list.sort((a, b) => b.at - a.at);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX / 2)));
  }
}

function upsert(v: Video, patch: Partial<Watch>) {
  const list = loadHistory();
  const i = list.findIndex((w) => w.id === v.id);
  const base: Watch =
    i >= 0
      ? list[i]
      : {
          id: v.id,
          ch: v.channelId,
          cht: v.channelTitle,
          title: v.title,
          cat: v.categoryId,
          tags: v.tags?.slice(0, 15),
          sec: 0,
          dur: v.duration,
          at: Date.now(),
        };
  const next = { ...base, ...patch, at: Date.now() };
  if (i >= 0) list[i] = next;
  else list.push(next);
  save(list);
}

/** Called by the player while you watch. `sec` is the total time watched so far. */
export function recordWatch(v: Video, sec: number) {
  if (!v?.id || sec < 3) return;
  const prev = loadHistory().find((w) => w.id === v.id);
  upsert(v, { sec: Math.max(prev?.sec || 0, Math.round(sec)), skip: false });
}

export function markLiked(v: Video, liked: boolean) {
  upsert(v, { liked });
}

export function notInterested(v: Video) {
  upsert(v, { skip: true });
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}

/** How much one watch says about your taste (negative = you didn't like it). */
function weight(w: Watch, now = Date.now()): number {
  const ageDays = (now - w.at) / 86400_000;
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  if (w.skip) return -1.5 * decay;
  const completion = w.dur > 0 ? Math.min(1, w.sec / w.dur) : Math.min(1, w.sec / 600);
  let s = w.sec < 20 ? -0.2 : 0.3 + completion + Math.min(1, w.sec / 1800); // long sessions count more
  if (w.liked) s += 1.5;
  return s * decay;
}

export function isSeen(w: Watch) {
  return w.skip || w.sec >= Math.min(90, (w.dur || 120) * 0.5);
}

export function seenIds(): Set<string> {
  return new Set(loadHistory().filter(isSeen).map((w) => w.id));
}

// ── topics ─────────────────────────────────────────────────

const STOP = new Set(
  (
    'the and for with you your this that from are was were have has had not but all can will just how what why who ' +
    'new video videos official full part episode live 2024 2025 2026 2027 vs feat ft hd 4k shorts short trailer ' +
    'и в на с по для это как что не из за от до или же уже все его она они мы вы ты'
  ).split(' '),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
    (t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t),
  );
}

function videoTerms(w: { title: string; tags?: string[] }): string[] {
  return [...new Set([...tokens(w.title), ...(w.tags || []).flatMap(tokens)])];
}

export type Profile = {
  watches: number;
  channels: { id: string; title: string; score: number }[];
  terms: { term: string; score: number }[];
  cats: { id: string; score: number }[];
  /** Recent videos you clearly enjoyed — used as seeds for "because you watched". */
  seeds: Watch[];
};

export function buildProfile(): Profile {
  const list = loadHistory();
  const now = Date.now();
  const ch = new Map<string, { id: string; title: string; score: number }>();
  const terms = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const w of list) {
    const s = weight(w, now);
    const c = ch.get(w.ch) || { id: w.ch, title: w.cht, score: 0 };
    c.score += s;
    ch.set(w.ch, c);
    if (w.cat) cats.set(w.cat, (cats.get(w.cat) || 0) + s);
    for (const t of videoTerms(w)) terms.set(t, (terms.get(t) || 0) + s);
  }
  const seeds = list
    .filter((w) => !w.skip && (w.liked || (w.dur > 0 && w.sec / w.dur >= 0.6) || w.sec >= 600))
    .slice(0, 6);
  return {
    watches: list.filter((w) => !w.skip).length,
    channels: [...ch.values()].filter((c) => c.score > 0).sort((a, b) => b.score - a.score),
    terms: [...terms.entries()]
      .filter(([, s]) => s > 0)
      .map(([term, score]) => ({ term, score }))
      .sort((a, b) => b.score - a.score),
    cats: [...cats.entries()]
      .filter(([, s]) => s > 0)
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score),
    seeds,
  };
}

/** The best search phrase for "more like this video": its words you care about most. */
export function seedQuery(w: Watch, profile: Profile): string {
  const score = new Map(profile.terms.map((t) => [t.term, t.score]));
  const own = videoTerms(w).sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0));
  return own.slice(0, 3).join(' ');
}
