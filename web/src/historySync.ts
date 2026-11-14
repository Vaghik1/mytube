// Keeps watch history the same on the TV and the phone, through your MyTube server.
// Each device sends what changed since its last sync and gets back what the other one did.
import { getAccessToken } from './auth';
import { loadHistory, mergeWatches, replaceHistory, type Watch } from './history';

export const SYNC_EVERY_MS = 2 * 60_000;
const SENT = 'mytube.hsync.sent'; // newest change already sent
const SEEN = 'mytube.hsync.seen'; // newest change already received
const CLEARED = 'mytube.hsync.cleared'; // last "clear history" we applied

const num = (k: string) => Number(localStorage.getItem(k) || 0);

async function call(body: unknown) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as { items: Watch[]; cleared: number };
}

let running: Promise<void> | null = null;

/** One round: send local changes, apply the other device's. Safe to call often. */
export function syncHistory(): Promise<void> {
  if (!running)
    running = (async () => {
      const local = loadHistory();
      const sent = num(SENT);
      const changed = local.filter((w) => w.at > sent);
      const { items, cleared } = await call({ items: changed, since: num(SEEN) });
      let mine = loadHistory(); // may have changed while we waited
      if (cleared > num(CLEARED)) {
        // History was cleared on another device: drop what was watched before that.
        mine = mine.filter((w) => w.at > cleared);
        localStorage.setItem(CLEARED, String(cleared));
      }
      replaceHistory(mergeWatches(mine, items));
      if (changed.length) localStorage.setItem(SENT, String(Math.max(...changed.map((w) => w.at))));
      if (items.length) localStorage.setItem(SEEN, String(Math.max(num(SEEN), ...items.map((w) => w.at))));
    })().finally(() => (running = null));
  return running;
}

/** Clear history on every device. */
export async function clearHistoryEverywhere() {
  const { cleared } = await call({ action: 'clear' });
  localStorage.setItem(CLEARED, String(cleared));
  localStorage.setItem(SENT, String(cleared));
}

let soon = 0;
/** Sync a moment after something changed (e.g. you left a video). */
export function syncSoon(ms = 3000) {
  window.clearTimeout(soon);
  soon = window.setTimeout(() => syncHistory().catch(() => {}), ms);
}

/** Sync now, then every couple of minutes while the app is on screen. Returns a stop function. */
export function startHistorySync(): () => void {
  const run = () => document.visibilityState === 'visible' && syncHistory().catch(() => {});
  run();
  const t = window.setInterval(run, SYNC_EVERY_MS);
  document.addEventListener('visibilitychange', run);
  return () => {
    window.clearInterval(t);
    window.clearTimeout(soon);
    document.removeEventListener('visibilitychange', run);
  };
}
