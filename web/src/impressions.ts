// Videos you keep scrolling past in For you drift down a little (like YouTube) — gently:
// being skipped is a hint, not a verdict. Nothing is ever hidden because of it, and the
// hint fades after a week. Counted once per app session, only after the card was on screen
// for a moment; opening the video resets it.

const KEY = 'mytube.imp';
/** Sessions a video can be passed over before it starts drifting. */
export const FREE_SESSIONS = 2;
/** Each further session moves it this many places down… */
export const STEP = 2;
/** …but never more than this many places in total. */
export const MAX_SHIFT = 8;
const FORGET_MS = 7 * 86400_000;
const MAX_ENTRIES = 2000;

type Entry = { n: number; last: number };
const seenThisSession = new Set<string>();

function load(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function save(m: Record<string, Entry>) {
  const now = Date.now();
  const kept = Object.entries(m)
    .filter(([, e]) => now - e.last < FORGET_MS)
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* ignore */
  }
}

/** A For you card was on screen for a moment. */
export function recordImpression(id: string) {
  if (seenThisSession.has(id)) return;
  seenThisSession.add(id);
  const m = load();
  const e = m[id] && Date.now() - m[id].last < FORGET_MS ? m[id] : { n: 0, last: 0 };
  m[id] = { n: e.n + 1, last: Date.now() };
  save(m);
}

/** You opened it: whatever happens next tells us more than scrolling past did. */
export function clearImpressions(id: string) {
  const m = load();
  if (m[id]) {
    delete m[id];
    save(m);
  }
}

/** How many places down this video should drift. */
export function shiftFor(id: string, now = Date.now()): number {
  const e = load()[id];
  if (!e || now - e.last >= FORGET_MS) return 0;
  return Math.min(MAX_SHIFT, STEP * Math.max(0, e.n - FREE_SESSIONS));
}

/** Same list, with often-skipped videos moved a few places down (order otherwise kept). */
export function demoteIgnored<T extends { id: string }>(list: T[]): T[] {
  const now = Date.now();
  const m = load();
  const shift = (id: string) => {
    const e = m[id];
    return !e || now - e.last >= FORGET_MS ? 0 : Math.min(MAX_SHIFT, STEP * Math.max(0, e.n - FREE_SESSIONS));
  };
  return list
    .map((v, i) => {
      const d = shift(v.id);
      return { v, k: i + d + (d ? 0.5 : 0) }; // moved d places: lands right after the video now there
    })
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

/** Tests: start a new app session. */
export function _newSession() {
  seenThisSession.clear();
}
