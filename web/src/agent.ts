// Talks to the MyTube assistant hub: shares your taste profile with ChatGPT and fetches its picks.
import { getAccessToken } from './auth';
import { getVideos, type Video } from './api';
import { loadSettings } from './config';
import { buildProfile, loadHistory, seenIds } from './history';

export type AgentPick = {
  id: string;
  type: 'video' | 'search';
  videoId?: string;
  query?: string;
  title?: string;
  reason?: string;
  source: string;
  addedAt: string;
};

async function hub(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const SYNC_KEY = 'mytube.agent.lastSync';

/** Sends the taste profile to the hub when it has changed (at most every few minutes). */
export async function syncProfile(force = false) {
  const history = loadHistory();
  const sig = `${history.length}:${history[0]?.at || 0}:${history[0]?.sec || 0}`;
  const last = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
  if (!force && last.sig === sig && Date.now() - (last.t || 0) < 6 * 3600_000) return;
  const p = buildProfile();
  const s = loadSettings();
  await hub('/api/sync', {
    method: 'POST',
    body: JSON.stringify({
      watches: p.watches,
      topChannels: p.channels.slice(0, 30).map((c) => ({ id: c.id, title: c.title, score: Math.round(c.score * 100) / 100 })),
      topTopics: p.terms.slice(0, 50).map((t) => t.term),
      recent: history.slice(0, 60).map((w) => ({
        id: w.id,
        title: w.title,
        channel: w.cht,
        watchedPct: w.dur ? Math.min(100, Math.round((w.sec / w.dur) * 100)) : 0,
        liked: w.liked || undefined,
        notInterested: w.skip || undefined,
        at: new Date(w.at).toISOString(),
      })),
      hideShorts: s.hideShorts,
      blockedChannels: s.blockedChannels,
      blockedKeywords: s.blockedKeywords,
    }),
  });
  localStorage.setItem(SYNC_KEY, JSON.stringify({ sig, t: Date.now() }));
}

let picksCache: { t: number; v: AgentPick[] } | null = null;

export async function getPicks(fresh = false): Promise<AgentPick[]> {
  if (!fresh && picksCache && Date.now() - picksCache.t < 5 * 60_000) return picksCache.v;
  const data = await hub('/api/picks');
  picksCache = { t: Date.now(), v: data.picks || [] };
  return picksCache.v;
}

/** Video picks with full details; each video carries ChatGPT's reason as `note`. */
export async function getPickVideos(): Promise<Video[]> {
  const picks = (await getPicks()).filter((p) => p.type === 'video' && p.videoId);
  const seen = seenIds();
  const vids = await getVideos(picks.map((p) => p.videoId!).filter((id) => !seen.has(id)));
  const reason = new Map(picks.map((p) => [p.videoId, p.reason || p.title || '']));
  return vids.map((v) => ({ ...v, note: reason.get(v.id) || undefined }));
}

export async function dismissPick(videoIdOrPickId: { id?: string; videoId?: string }) {
  picksCache = null;
  await hub('/api/picks', { method: 'POST', body: JSON.stringify({ action: 'dismiss', ...videoIdOrPickId }) }).catch(() => {});
}
