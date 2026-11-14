// "Play on TV": the phone sends a video to the TV through your MyTube server.
// The TV checks for a new command every few seconds while MyTube is open on it.
import { getAccessToken } from './auth';

export const POLL_MS = 6000;
const DONE_KEY = 'mytube.remote.done';

async function call(init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch('/api/remote', {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Phone: ask the TV to play this video from `start` seconds. */
export async function sendToTv(videoId: string, start = 0) {
  await call({ method: 'POST', body: JSON.stringify({ videoId, start: Math.floor(start) }) });
}

export type RemoteCommand = { id: string; videoId: string; start: number; at: number };

/** TV: watch for commands. Returns a function that stops watching. */
export function listenForTvCommands(onCommand: (c: RemoteCommand) => void): () => void {
  let stopped = false;
  let timer = 0;
  const check = async () => {
    window.clearTimeout(timer);
    if (stopped) return;
    if (document.visibilityState === 'visible') {
      try {
        const { command } = (await call()) as { command: RemoteCommand | null };
        if (command && localStorage.getItem(DONE_KEY) !== command.id) {
          localStorage.setItem(DONE_KEY, command.id);
          onCommand(command);
        }
      } catch {
        /* offline or signed out: try again later */
      }
    }
    if (!stopped) timer = window.setTimeout(check, POLL_MS);
  };
  const onVisible = () => document.visibilityState === 'visible' && check();
  document.addEventListener('visibilitychange', onVisible);
  check();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
