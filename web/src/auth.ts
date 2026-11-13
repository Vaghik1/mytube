// Token storage and refresh. Sign-in itself happens on the Login page (device code flow).

type Tokens = { access_token: string; refresh_token?: string; expires_at: number };
const KEY = 'mytube.tokens';

let refreshing: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

export function onAuthChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function emit() {
  listeners.forEach((fn) => fn());
}

function load(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function isSignedIn() {
  const t = load();
  return !!(t && (t.refresh_token || t.expires_at > Date.now()));
}

export function saveTokens(data: { access_token: string; refresh_token?: string; expires_in: number }) {
  const prev = load();
  const t: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  localStorage.setItem(KEY, JSON.stringify(t));
  emit();
}

export function signOut() {
  localStorage.removeItem(KEY);
  Object.keys(localStorage)
    .filter((k) => k.startsWith('mytube.cache.'))
    .forEach((k) => localStorage.removeItem(k));
  emit();
}

export async function getAccessToken(force = false): Promise<string | null> {
  const t = load();
  if (!t) return null;
  if (!force && t.expires_at - 60_000 > Date.now()) return t.access_token;
  if (!t.refresh_token) {
    signOut();
    return null;
  }
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: t.refresh_token }),
        });
        const data = await res.json();
        if (!res.ok || !data.access_token) {
          if (data.error === 'invalid_grant') signOut();
          return null;
        }
        saveTokens(data);
        return data.access_token as string;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}
