// Self-update for the Android app (phone and TV).
// On open, the app compares its version with the latest GitHub release of the APK.
// If newer, it offers an update: the app downloads the APK and Android asks once to install.
import { useEffect, useState } from 'react';
import { android as defaultBridge, type Bridge } from './tv';

export const RELEASES_URL = 'https://api.github.com/repos/Vaghik1/mytube/releases/latest';
export const APK_PAGE = `${typeof location !== 'undefined' ? location.origin : ''}/apk`;

export type UpdateInfo = { version: number; url: string };
export type UpdateState = {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'permission' | 'confirm' | 'error';
  update?: UpdateInfo;
  progress?: number;
  error?: string;
  dismissed?: boolean;
};

let bridge: Bridge | undefined = defaultBridge;
let state: UpdateState = { status: 'idle' };
const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Tests: swap the Android bridge and reset. */
export function _resetUpdate(b: Bridge | undefined) {
  bridge = b;
  state = { status: 'idle' };
  delete (window as any).__mytubeUpdate;
}

export function getUpdateState() {
  return state;
}

/** Installed app version: versionName is "1.<build number>". */
export function installedVersion(): number | null {
  const v = bridge?.appVersion?.();
  const m = v && /^1\.(\d+)$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Whether this app can download and install updates itself (apps from this version on). */
export function canSelfUpdate() {
  return typeof bridge?.installUpdate === 'function';
}

export async function checkForUpdate(): Promise<UpdateState> {
  const current = installedVersion();
  if (current === null) return state; // website in a browser, or an unknown version
  if (state.status === 'checking' || state.status === 'downloading') return state;
  set({ status: 'checking', error: undefined });
  try {
    const r = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const rel = await r.json();
    const version = Number(/(\d+)$/.exec(rel.tag_name || '')?.[1]);
    const asset = (rel.assets || []).find((a: any) => /\.apk$/i.test(a.name));
    if (!version || !asset) throw new Error('No APK in the latest release');
    if (version > current) set({ status: 'available', update: { version, url: asset.browser_download_url } });
    else set({ status: 'none', update: undefined });
  } catch (e: any) {
    set({ status: 'error', error: e?.message || 'Could not check for updates' });
  }
  return state;
}

/** Called by the Android app while it downloads and installs. */
function onNativeStatus(status: string, value?: number | string) {
  if (status === 'downloading') set({ status: 'downloading', progress: Number(value) || 0 });
  else if (status === 'permission') set({ status: 'permission' });
  else if (status === 'confirm') set({ status: 'confirm' });
  else if (status === 'cancelled') set({ status: 'available' });
  else if (status === 'error') set({ status: 'error', error: String(value || 'Update failed') });
}

export function installUpdate() {
  if (!state.update || !canSelfUpdate()) return;
  (window as any).__mytubeUpdate = onNativeStatus;
  set({ status: 'downloading', progress: 0, error: undefined });
  bridge!.installUpdate!(state.update.url);
}

export function dismissUpdate() {
  set({ dismissed: true });
}

export function useUpdate() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}
