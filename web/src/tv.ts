// TV remote support: D-pad spatial navigation, Back button, and the Android app bridge.
// Any element with className "focusable" can be reached with the arrow keys.

type KeyHandler = (e: KeyboardEvent) => boolean; // return true = handled
const keyHandlers: KeyHandler[] = [];
const backHandlers: (() => boolean)[] = [];

/** Let a page take over keys (e.g. the video player). Returns an unregister function. */
export function pushKeyHandler(h: KeyHandler) {
  keyHandlers.push(h);
  return () => {
    const i = keyHandlers.lastIndexOf(h);
    if (i >= 0) keyHandlers.splice(i, 1);
  };
}

/** Let a page intercept the Back button. Returns an unregister function. */
export function pushBackHandler(h: () => boolean) {
  backHandlers.push(h);
  return () => {
    const i = backHandlers.lastIndexOf(h);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

/** Called by the Android app on the remote's Back button. Returns false to exit the app. */
export function handleBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
  if (location.pathname !== '/') {
    // Go back only through MyTube's own pages (the router numbers them). The WebView's history
    // can also hold older entries from outside the app, and going back into those showed a black screen.
    if (((history.state as { idx?: number } | null)?.idx ?? 0) > 0) history.back();
    else {
      history.replaceState(null, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    }
    return true;
  }
  // Home: leave the app. Close it ourselves rather than letting the WebView "go back" further.
  const bridge = (window as any).MyTubeAndroid as Bridge | undefined;
  if (bridge?.exitApp) {
    bridge.exitApp();
    return true;
  }
  return false;
}

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

// Kept cheap on purpose (runs for every element on every key press): no style lookups.
function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return !el.closest('[aria-hidden="true"]');
}

function candidates(): HTMLElement[] {
  const scope = document.querySelector<HTMLElement>('[data-focus-trap]') || document;
  return Array.from(scope.querySelectorAll<HTMLElement>('.focusable')).filter(visible);
}

export function focusEl(el: HTMLElement | null | undefined, center = true) {
  if (!el || isTouch) return;
  el.focus({ preventScroll: true });
  // Instant: smooth scrolling queues up and lags on TV sticks when you hold a direction.
  el.scrollIntoView({ block: center ? 'center' : 'nearest', inline: 'nearest' });
}

export function focusFirst(): boolean {
  const all = candidates();
  const main = all.filter((el) => el.closest('main'));
  const pick =
    all.find((el) => el.hasAttribute('data-autofocus')) || main[0] || all[0];
  if (pick) focusEl(pick);
  return !!pick;
}

function move(dir: Dir) {
  const active = document.activeElement as HTMLElement | null;
  const all = candidates();
  if (!active || active === document.body || !all.includes(active)) {
    focusFirst();
    return;
  }
  const r = active.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === active) continue;
    const c = el.getBoundingClientRect();
    const ex = c.left + c.width / 2;
    const ey = c.top + c.height / 2;
    let main = 0;
    let cross = 0;
    if (dir === 'right') {
      if (ex <= cx + 1 || c.right <= r.right - 4) continue;
      main = Math.max(0, c.left - r.right);
      cross = Math.abs(ey - cy);
    } else if (dir === 'left') {
      if (ex >= cx - 1 || c.left >= r.left + 4) continue;
      main = Math.max(0, r.left - c.right);
      cross = Math.abs(ey - cy);
    } else if (dir === 'down') {
      if (ey <= cy + 1 || c.top < r.top + 4) continue;
      main = Math.max(0, c.top - r.bottom);
      cross = Math.abs(ex - cx);
    } else {
      if (ey >= cy - 1 || c.bottom > r.bottom - 4) continue;
      main = Math.max(0, r.top - c.bottom);
      cross = Math.abs(ex - cx);
    }
    const score = main + cross * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focusEl(best, dir === 'up' || dir === 'down');
}

let teardown: (() => void) | null = null;

/** Sets up remote-control navigation. Safe to call twice; returns a function that undoes it. */
export function initTV(): () => void {
  teardown?.();
  const onKey = (e: KeyboardEvent) => {
      for (let i = keyHandlers.length - 1; i >= 0; i--) {
        if (keyHandlers[i](e)) {
          e.preventDefault();
          return;
        }
      }
      const active = document.activeElement as HTMLElement | null;
      const typing = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';
      const dir = DIRS[e.key];
      if (dir) {
        if (typing && (dir === 'left' || dir === 'right')) {
          const input = active as HTMLInputElement;
          const atStart = input.selectionStart === 0 && dir === 'left';
          const atEnd = input.selectionEnd === input.value.length && dir === 'right';
          if (!atStart && !atEnd) return;
        }
        e.preventDefault();
        move(dir);
        return;
      }
      if (e.key === 'Enter' && active && !typing && active.tagName !== 'BUTTON' && active.tagName !== 'A') {
        if (active.classList.contains('focusable')) {
          e.preventDefault();
          active.click();
        }
        return;
      }
      if ((e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !typing))) {
        e.preventDefault();
        handleBack();
      }
  };
  document.addEventListener('keydown', onKey, true);
  (window as any).__tvBack = handleBack;

  if (isTouch) {
    document.documentElement.classList.add('touch');
    teardown = () => {
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.classList.remove('touch');
      teardown = null;
    };
    return teardown;
  }
  // Keep something focused at all times so the remote always works.
  const keepFocus = () => {
    const a = document.activeElement;
    if (!a || a === document.body || !document.contains(a)) focusFirst();
  };
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return; // one check per frame, however many changes
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      keepFocus();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  teardown = () => {
    document.removeEventListener('keydown', onKey, true);
    observer.disconnect();
    teardown = null;
  };
  return teardown;
}

// ── Android app bridge (present only inside the TV app) ─────────

export type Bridge = {
  openInYouTube(id: string): void;
  exitApp(): void;
  appVersion?(): string;
  isTv?(): boolean;
  /** Newer apps: download this APK and ask Android to install it (progress via window.__mytubeUpdate). */
  installUpdate?(url: string): void;
  /** Newer apps: speech-to-text through Android (result via window.__mytubeVoice). */
  hasVoiceSearch?(): boolean;
  startVoiceSearch?(): void;
};
export const android: Bridge | undefined = (window as any).MyTubeAndroid;
const hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
/** Running inside the MyTube app on a TV (remote control). The same app on a phone is not a TV. */
export const isTVApp = !!android && (android.isTv ? !!android.isTv() : !hasTouch);
/** Phones and tablets (browser or app): tap controls instead of remote navigation. */
export const isTouch = !isTVApp && hasTouch;

export function openInYouTube(videoId: string) {
  if (android) android.openInYouTube(videoId);
  else window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
}
