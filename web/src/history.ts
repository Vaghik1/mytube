// Your personal watch history, kept on this device, and the taste profile learned from it.
// Everything here updates automatically as you watch; nothing is sent anywhere except
// the YouTube searches built from your top topics.
import type { Video } from './api';
import { clearImpressions } from './impressions';

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
  opens?: number; // times you started it (played at least a few seconds)
  pos?: number; // where you stopped (seconds), to resume and to draw the progress bar
  /** Watched in YouTube itself (imported from Google Takeout), not in MyTube. */
  yt?: boolean;
  /** Imported: when you watched it on YouTube (ms). `at` is when it was imported, so it syncs. */
  t?: number;
};

/** When you actually watched it (imported YouTube watches keep their own time). */
export const watchedAt = (w: Watch) => (w.yt && w.t ? w.t : w.at);

const KEY = 'mytube.history';
const MAX = 800;
const HALF_LIFE_DAYS = 14;

// Parsed once and reused until the stored text changes (every video card asks for it).
let memoRaw: string | null = null;
let memo: Watch[] = [];
export function loadHistory(): Watch[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== memoRaw) {
      memo = JSON.parse(raw || '[]');
      memoRaw = raw;
    }
    return memo.slice();
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
export function recordWatch(v: Video, sec: number, pos?: number) {
  if (!v?.id || sec < 3) return;
  const prev = loadHistory().find((w) => w.id === v.id);
  upsert(v, {
    sec: Math.max(prev?.sec || 0, Math.round(sec)),
    ...(pos !== undefined && pos >= 0 ? { pos: Math.round(pos), dur: v.duration || prev?.dur || 0 } : {}),
    skip: false,
    yt: undefined, // watched here now: a normal MyTube watch
    t: undefined,
  });
}

/** Called once each time you start a video (after a few seconds of playing). */
export function startedWatching(v: Video) {
  if (!v?.id) return;
  clearImpressions(v.id);
  const prev = loadHistory().find((w) => w.id === v.id);
  upsert(v, { opens: (prev?.opens || 0) + 1, skip: false, yt: undefined, t: undefined });
}

export function markLiked(v: Video, liked: boolean) {
  upsert(v, { liked });
}

export function notInterested(v: Video) {
  upsert(v, { skip: true });
}

/** Imported YouTube watches: at most this many, from at most this far back. */
export const IMPORT_MAX = 500;
export const IMPORT_DAYS = 120;

/**
 * Adds videos you watched in YouTube itself (from Google Takeout). Videos already in your MyTube
 * history are left as they are. Returns how many were added.
 */
export function importWatches(list: { id: string; ch: string; cht: string; title: string; t: number }[], now = Date.now()): number {
  const history = loadHistory();
  const have = new Set(history.map((w) => w.id));
  const fresh = list
    .filter((x) => x.id && x.ch && now - x.t < IMPORT_DAYS * 86400_000 && x.t <= now)
    .sort((a, b) => b.t - a.t);
  const added: Watch[] = [];
  for (const x of fresh) {
    if (added.length >= IMPORT_MAX) break;
    if (have.has(x.id)) continue;
    have.add(x.id);
    added.push({ id: x.id, ch: x.ch, cht: x.cht, title: x.title, sec: 0, dur: 0, at: now, yt: true, t: x.t });
  }
  if (added.length) save([...history, ...added]);
  return added.length;
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}

/**
 * Combines two histories (this device's and the other device's, via the server).
 * Per video: the most recently updated copy wins, but time watched / starts / length only grow.
 * The same rules run on the server (api/hub.ts) — keep them in step.
 */
export function mergeWatches(a: Watch[], b: Watch[]): Watch[] {
  const map = new Map<string, Watch>();
  for (const w of [...a, ...b]) {
    if (!w?.id) continue;
    const prev = map.get(w.id);
    if (!prev) {
      map.set(w.id, w);
      continue;
    }
    const [older, newer] = prev.at > w.at ? [w, prev] : [prev, w];
    map.set(w.id, {
      ...older,
      ...newer,
      sec: Math.max(older.sec || 0, newer.sec || 0),
      dur: Math.max(older.dur || 0, newer.dur || 0),
      ...(older.opens || newer.opens ? { opens: Math.max(older.opens || 0, newer.opens || 0) } : {}),
    });
  }
  return [...map.values()].sort((x, y) => y.at - x.at).slice(0, MAX);
}

/** Replaces this device's history (used by sync). */
export function replaceHistory(list: Watch[]) {
  save([...list]);
}

/** Live streams: watched less than this is just a look, not interest. */
export const LIVE_PEEK_SEC = 300;
/** Live streams: watching this long counts like finishing a video. */
export const LIVE_FULL_SEC = 1800;

/** How much one watch says about your taste (negative = you didn't like it). */
function weight(w: Watch, now = Date.now()): number {
  const ageDays = (now - watchedAt(w)) / 86400_000;
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  if (w.skip) return -1.5 * decay;
  // Watched in YouTube: we don't know for how long, so it counts like a solid, ordinary watch.
  if (w.yt) return 0.8 * decay;
  // A live stream has no length: only staying a while says you like it (a quick look says you don't).
  const live = !(w.dur > 0);
  const completion = live ? Math.min(1, w.sec / LIVE_FULL_SEC) : Math.min(1, w.sec / w.dur);
  const peek = w.sec < (live ? LIVE_PEEK_SEC : 20);
  let s = peek ? -0.2 : 0.3 + completion + Math.min(1, w.sec / 1800); // long sessions count more
  if (w.liked) s += 1.5;
  return s * decay;
}

// ── Watched / in progress (like YouTube's red bar and Netflix's "Continue watching") ──

/** Played for less than this: just a peek, not "in progress". */
export const PEEK_SEC = 20;
/** Unfinished videos come back in For you for this long after you last played them… */
export const CONTINUE_FOR_MS = 7 * 86400_000;
/** …and a peek stays out of suggestions for this long. */
export const PEEK_COOLDOWN_MS = 3 * 86400_000;

/** Finished: reached the last 5% (at least the last 30 seconds), like YouTube's "mostly complete". */
export function isFinished(w: Watch) {
  if (!w.dur) return w.sec >= 90;
  if (w.pos === undefined) return w.sec >= w.dur * 0.9; // older history without a position
  return w.pos >= w.dur - Math.max(30, w.dur * 0.05);
}

/** Started for real but not finished, and played within the last week. */
export function isInProgress(w: Watch, now = Date.now()) {
  return !w.skip && !isFinished(w) && w.sec >= PEEK_SEC && (w.pos || 0) > 0 && now - w.at < CONTINUE_FOR_MS;
}

/**
 * Should this video stay out of the normal suggestions?
 *  • "Not interested" or finished: never suggested again.
 *  • In progress: handled separately (comes back as "continue watching", never at the top).
 *  • Unfinished and not played for a week: you've moved on, not suggested again.
 *  • A short peek: out for 3 days, then it may come back.
 */
export function isSeen(w: Watch, now = Date.now()) {
  if (w.skip || w.yt || isFinished(w)) return true; // already watched in YouTube: don't suggest it again
  if (w.sec >= PEEK_SEC) return true; // in progress (shown separately) or abandoned after a week
  if (w.sec >= 3 && now - w.at < PEEK_COOLDOWN_MS) return true;
  return false;
}

/** Unfinished videos to bring back, most recently played first. */
export function continueWatching(now = Date.now()): Watch[] {
  return loadHistory()
    .filter((w) => isInProgress(w, now))
    .sort((a, b) => b.at - a.at);
}

// ── Where a muted preview got to ──
// Kept apart from watch history: a preview playing as you browse isn't "watching" it, so it never
// hides videos or teaches For you anything. It only remembers the spot, so the preview — and the
// video when you open it — carry on from there.
const PREVIEW_KEY = 'mytube.previewPos';
const PREVIEW_KEEP_MS = 7 * 86400_000;
type PreviewPos = { pos: number; dur: number; at: number };
function loadPreviewPos(): Record<string, PreviewPos> {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePreviewMap(m: Record<string, PreviewPos>) {
  const now = Date.now();
  const kept = Object.entries(m)
    .filter(([, p]) => now - p.at < PREVIEW_KEEP_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 300);
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* ignore */
  }
}
/** A preview reached `pos` seconds (of `dur`). */
export function savePreviewPos(id: string, pos: number, dur: number) {
  if (!id || !(pos > 0)) return;
  const m = loadPreviewPos();
  m[id] = { pos: Math.round(pos), dur: Math.round(dur || 0), at: Date.now() };
  savePreviewMap(m);
}
/** A preview played to the end (or is no longer needed). */
export function clearPreviewPos(id: string) {
  const m = loadPreviewPos();
  if (m[id]) {
    delete m[id];
    savePreviewMap(m);
  }
}

/**
 * Where to start this video, and where its red bar ends: the most recent of where you stopped
 * watching it and where its preview got to. Null for new or finished videos.
 */
export function startPoint(id: string): { pos: number; dur: number } | null {
  const w = loadHistory().find((x) => x.id === id);
  const p = loadPreviewPos()[id];
  const fresh = p && Date.now() - p.at < PREVIEW_KEEP_MS && p.pos >= 5 && (!p.dur || p.pos < p.dur - 10) ? p : null;
  if (w?.skip) return null;
  if (fresh && (!w || fresh.at > w.at)) return { pos: fresh.pos, dur: fresh.dur || w?.dur || 0 };
  return resumePoint(id);
}

/** Where you stopped in a video you haven't finished (for the red bar and resuming), or null. */
export function resumePoint(id: string): { pos: number; dur: number } | null {
  const w = loadHistory().find((x) => x.id === id);
  if (!w || w.skip || !w.pos || !w.dur || isFinished(w) || w.pos < 10) return null;
  return { pos: w.pos, dur: w.dur };
}

export function seenIds(): Set<string> {
  const now = Date.now();
  return new Set(loadHistory().filter((w) => isSeen(w, now)).map((w) => w.id));
}

// ── topics ─────────────────────────────────────────────────

// Words that say nothing about what a video is about (filler, opinions, clickbait).
const STOP = new Set(
  (
    'the and for with you your this that from are was were have has had not but all can will just how what why who ' +
    'new video videos official full part episode live 2024 2025 2026 2027 vs feat ft hd 4k shorts short trailer ' +
    'about above after again against also always any anyone anything around because been before being better ' +
    'between big biggest both came come comes could did does doing done dont don down during each even ever every ' +
    'everyone everything few finally first found get gets getting give goes going gonna good got great had happened ' +
    'happens here hers him his into its it\'s itself keep know last least less let lets like literally little long look ' +
    'looks lot lots made make makes making many may maybe might more most much must need needs never next nobody ' +
    'nothing now off once one only other others our ours out over own people please pretty quite rather real really ' +
    'right said same say says see seen should show shows since some someone something still such sure take takes ' +
    'tell than thank thanks their them then there these they thing things think thinks thought those though three ' +
    'through time times today told too took top totally try trying two under until upon use used using very want ' +
    'wants way ways well went what\'s when where which while whole will wish without wont worse worst would wow yes ' +
    'yet you\'re best bad better huge insane crazy actually absolutely completely changed change changes ever ' +
    'here\'s nobody\'s reason reasons why\'s day days week weeks year years ago again guide watch watching stop ' +
    'start started starting world life lol omg ' +
    'и в на с по для это как что не из за от до или же уже все его она они мы вы ты'
  ).split(' '),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
    (t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t),
  );
}

/** Title words count much less than the creator's own tags: titles are full of hype words. */
export const TITLE_WEIGHT = 0.35;

function videoTerms(w: { title: string; tags?: string[] }): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokens(w.title)) out.set(t, TITLE_WEIGHT);
  for (const t of (w.tags || []).flatMap(tokens)) out.set(t, 1);
  return out;
}

export type Profile = {
  watches: number;
  channels: { id: string; title: string; score: number }[];
  terms: { term: string; score: number }[];
  /** Topics you keep turning away from (left quickly, "Not interested"): score below zero. */
  avoid: { term: string; score: number }[];
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
    for (const [t, k] of videoTerms(w)) terms.set(t, (terms.get(t) || 0) + s * k);
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
    avoid: [...terms.entries()]
      .filter(([, s]) => s < 0)
      .map(([term, score]) => ({ term, score }))
      .sort((a, b) => a.score - b.score),
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
  const own = [...videoTerms(w).keys()].sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0));
  return own.slice(0, 3).join(' ');
}
