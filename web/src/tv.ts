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
  if (location.pathname !== '/' && history.length > 1) {
    history.back();
    return true;
  }
  if (location.pathname !== '/') {
    history.replaceState(null, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
    return true;
  }
  return false;
}

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
}

function candidates(): HTMLElement[] {
  const scope = document.querySelector<HTMLElement>('[data-focus-trap]') || document;
  return Array.from(scope.querySelectorAll<HTMLElement>('.focusable')).filter(visible);
}

export function focusEl(el: HTMLElement | null | undefined, center = true) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: center ? 'center' : 'nearest', inline: 'nearest', behavior: 'smooth' });
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

export function initTV() {
  document.addEventListener(
    'keydown',
    (e) => {
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
    },
    true,
  );

  // Keep something focused at all times so the remote always works.
  const keepFocus = () => {
    const a = document.activeElement;
    if (!a || a === document.body || !document.contains(a)) focusFirst();
  };
  new MutationObserver(() => requestAnimationFrame(keepFocus)).observe(document.body, {
    childList: true,
    subtree: true,
  });

  (window as any).__tvBack = handleBack;
}

// ── Android app bridge (present only inside the TV app) ─────────

type Bridge = { openInYouTube(id: string): void; exitApp(): void; appVersion?(): string };
export const android: Bridge | undefined = (window as any).MyTubeAndroid;
export const isTVApp = !!android;

export function openInYouTube(videoId: string) {
  if (android) android.openInYouTube(videoId);
  else window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
}
