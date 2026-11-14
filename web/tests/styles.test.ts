// @vitest-environment node
// Layout rules for TV, phone and tablet, checked straight from styles.css.
// (Guards against bugs like the phone tab bar collapsing after a tap.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8'));

type Found = { rule: Rule; media: string[] };
function rules(match: (sel: string) => boolean): Found[] {
  const out: Found[] = [];
  root.walkRules((rule) => {
    if (!rule.selectors.some(match)) return;
    const media: string[] = [];
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent as typeof p) {
      if (p.type === 'atrule' && (p as AtRule).name === 'media') media.push((p as AtRule).params);
    }
    out.push({ rule, media });
  });
  return out;
}
const decl = (r: Rule, prop: string) => r.nodes.find((n) => n.type === 'decl' && n.prop === prop) as { value: string } | undefined;
const px = (media: string, kind: 'min' | 'max') => Number(media.match(new RegExp(`${kind}-width:\\s*(\\d+)px`))?.[1] ?? NaN);
/** Would this media list apply on a screen of this width? */
const appliesAt = (media: string[], width: number) =>
  media.every((m) => !(px(m, 'min') > width) && !(px(m, 'max') < width));
const appliesOnPhone = (media: string[]) => appliesAt(media, 390);

/** Rough CSS specificity: [ids, classes + pseudo-classes, elements]. */
function specificity(sel: string): number {
  const ids = (sel.match(/#/g) || []).length;
  const classes = (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/(?<!:):[\w-]+/g) || []).length;
  const elements = sel.split(/[\s>+~]+/).filter((part) => /^[a-z]/i.test(part)).length;
  return ids * 10000 + classes * 100 + elements;
}

/**
 * The value a browser would use for `prop` on an element matched by any of `selectors`
 * at a given screen width: highest specificity wins, later rules win ties.
 */
function computed(selectors: string[], prop: string, width: number): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  let order = 0;
  root.walkRules((rule) => {
    order++;
    const media: string[] = [];
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent as typeof p)
      if (p.type === 'atrule' && (p as AtRule).name === 'media') media.push((p as AtRule).params);
    if (!appliesAt(media, width)) return;
    const d = decl(rule, prop);
    if (!d) return;
    for (const sel of rule.selectors) {
      if (!selectors.includes(sel)) continue;
      const spec = specificity(sel);
      if (!best || spec > best.spec || (spec === best.spec && order >= best.order)) best = { spec, order, value: d.value };
    }
  });
  return best?.value;
}

// Every selector that can match the menu on a touch screen, with and without focus inside it.
const SIDEBAR = ['.sidebar', '.sidebar:focus-within', 'html.touch .sidebar', 'html.touch .sidebar:focus-within'];
const LABEL = ['.sidebar .label', '.sidebar:focus-within .label', 'html.touch .sidebar .label', 'html.touch .sidebar:focus-within .label'];

describe('phone (≤820px wide)', () => {
  const phoneBar = rules((s) => s === '.sidebar').filter((f) => f.media.some((m) => px(m, 'max') === 820));

  it('turns the side menu into a bottom bar across the full width', () => {
    expect(phoneBar.length).toBeGreaterThan(0);
    const r = phoneBar[0].rule;
    expect(decl(r, 'position')?.value).toBe('fixed');
    expect(decl(r, 'bottom')?.value).toBe('0');
    expect(decl(r, 'left')?.value).toBe('0');
    expect(decl(r, 'right')?.value).toBe('0');
    expect(decl(r, 'flex-direction')?.value).toBe('row');
  });

  it('keeps the bar full width after a tab is tapped (focus inside the bar)', () => {
    // Regression: a touch-only TV rule used to shrink the focused bar into the corner.
    for (const w of [360, 390, 430, 600, 820]) {
      expect(computed(SIDEBAR, 'width', w), `width at ${w}px`).toBe('auto');
      expect(computed(SIDEBAR, 'position', w), `position at ${w}px`).toBe('fixed');
      expect(computed(SIDEBAR, 'flex-direction', w), `direction at ${w}px`).toBe('row');
    }
  });

  it('always shows the tab labels on phones, tapped or not', () => {
    for (const w of [360, 390, 820]) expect(computed(LABEL, 'opacity', w), `labels at ${w}px`).toBe('1');
  });

  it('shows one video per row', () => {
    const grid = rules((s) => s === '.grid').filter((f) => f.media.some((m) => px(m, 'max') === 820) && !f.media.some((m) => px(m, 'min') > 0));
    expect(decl(grid[0].rule, 'grid-template-columns')?.value).toBe('1fr');
  });

  it('shows two per row on wide phones / small tablets', () => {
    const grid = rules((s) => s === '.grid').filter((f) => f.media.some((m) => px(m, 'min') === 560));
    expect(decl(grid[0].rule, 'grid-template-columns')?.value).toBe('repeat(2, 1fr)');
  });

  it('leaves room at the bottom so the tab bar does not cover content', () => {
    const page = rules((s) => s === '.page').filter((f) => f.media.some((m) => px(m, 'max') === 820));
    expect(decl(page[0].rule, 'padding')?.value).toMatch(/8rem/);
  });
});

describe('TV (default)', () => {
  it('uses a 4-column grid', () => {
    const grid = rules((s) => s === '.grid').filter((f) => f.media.length === 0);
    expect(decl(grid[0].rule, 'grid-template-columns')?.value).toBe('repeat(4, 1fr)');
  });

  it('highlights the focused card and buttons for the remote', () => {
    expect(rules((s) => s === '.card:focus').some((f) => f.media.length === 0)).toBe(true);
    expect(rules((s) => s === '.btn:focus').some((f) => f.media.length === 0)).toBe(true);
    expect(rules((s) => s === '.nav-item:focus').some((f) => f.media.length === 0)).toBe(true);
  });

  it('expands the side menu when it has focus', () => {
    expect(computed(['.sidebar:focus-within'], 'width', 1920)).toBe('calc(24rem + var(--safe-left))');
    expect(computed(['.sidebar'], 'width', 1920)).toBe('calc(var(--sidebar) + var(--safe-left))');
  });

  it('tablets and landscape phones keep a slim side menu even when tapped', () => {
    expect(computed(SIDEBAR, 'width', 1024)).toBe('calc(var(--sidebar) + var(--safe-left))');
  });
});

describe('phone player', () => {
  it('lets you tap the video (TV blocks taps on purpose)', () => {
    const r = rules((s) => s.includes('.watch.web .player')).find((f) => decl(f.rule, 'pointer-events'));
    expect(decl(r!.rule, 'pointer-events')?.value).toBe('auto');
  });
  it('keeps the video 16:9 at the top of the page', () => {
    const r = rules((s) => s === '.watch.web .player')[0].rule;
    expect(decl(r, 'aspect-ratio')?.value.replace(/\s/g, '')).toBe('16/9');
    expect(decl(r, 'position')?.value).toBe('relative');
  });
});

describe('notch / status bar / navigation bar (safe areas)', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

  it('lets the page draw edge to edge (needed for safe-area values)', () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it("uses the app's exact values first, then env(), then 0", () => {
    const rootRule = rules((s) => s === ':root')[0].rule;
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(decl(rootRule, `--safe-${side}`)?.value).toBe(`var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px))`);
  });

  it('uses env() only through those variables', () => {
    root.walkDecls((d) => {
      if (d.value.includes('env(safe-area')) expect((d.parent as Rule).selector).toBe(':root');
    });
  });

  it('phone pages start below the status bar / notch (via the top bar) and stay clear on the sides', () => {
    expect(computed(['.topbar'], 'margin-top', 390)).toBe('var(--safe-top)');
    expect(computed(['.topbar'], 'top', 390)).toBe('var(--safe-top)');
    const v = computed(['.page'], 'padding', 390)!;
    expect(v).toContain('var(--safe-left)');
    expect(v).toContain('var(--safe-right)');
    expect(v).toContain('var(--safe-bottom)');
  });

  it('the tab bar sits above the gesture / navigation bar', () => {
    for (const sel of [['.sidebar'], ['.sidebar:focus-within']]) expect(computed(sel, 'padding', 390)).toContain('var(--safe-bottom)');
  });

  it('the phone player and the sign-in screen avoid the notch', () => {
    expect(computed(['.watch.web'], 'padding-top', 390)).toBe('var(--safe-top)');
    expect(computed(['.login'], 'padding', 390)).toContain('var(--safe-top)');
  });

  it('landscape phones keep the side menu clear of a side notch', () => {
    expect(computed(SIDEBAR, 'padding', 900)).toContain('var(--safe-left)');
    expect(computed(['.page'], 'padding', 900)).toContain('var(--safe-right)');
  });

  it('every fixed bar at the bottom pads for the navigation bar', () => {
    root.walkRules((r) => {
      if (decl(r, 'position')?.value === 'fixed' && decl(r, 'bottom')?.value === '0')
        expect(decl(r, 'padding')?.value, r.selector).toContain('var(--safe-bottom)');
    });
  });
});

describe('phone status bar and top bar (like YouTube)', () => {
  it('are hidden on TV and wide screens', () => {
    expect(computed(['.statusbar'], 'display', 1920)).toBe('none');
    expect(computed(['.topbar'], 'display', 1920)).toBe('none');
  });

  it('the status bar strip covers exactly the status bar area, above everything', () => {
    expect(computed(['.statusbar'], 'display', 390)).toBe('block');
    expect(computed(['.statusbar'], 'position', 390)).toBe('fixed');
    expect(computed(['.statusbar'], 'height', 390)).toBe('var(--safe-top)');
    expect(Number(computed(['.statusbar'], 'z-index', 390))).toBeGreaterThan(Number(computed(['.topbar'], 'z-index', 390)));
  });

  it('is solid at the top and a translucent tint once content scrolls under it', () => {
    expect(computed(['.statusbar'], 'background', 390)).toBe('var(--bg)');
    const tint = computed(['.statusbar', '.statusbar.scrolled'], 'background', 390)!;
    expect(tint).toMatch(/rgba\(.*,\s*\.?\d*\)/);
    expect(computed(['.statusbar.scrolled'], 'backdrop-filter', 390)).toMatch(/blur/);
  });

  it('the top bar slides fully off screen when hidden', () => {
    expect(computed(['.topbar.hidden'], 'transform', 390)).toContain('var(--safe-top)');
    expect(computed(['.topbar'], 'position', 390)).toBe('sticky');
  });
});

describe('phone player page', () => {
  it('the video is sized by the screen width (16:9), never by the page height', () => {
    expect(computed(['.player', '.watch.web .player'], 'height', 390)).toBe('auto');
    expect(computed(['.player', '.watch.web .player'], 'aspect-ratio', 390)).toBe('16 / 9');
    expect(computed(['.player', '.watch.web .player'], 'width', 390)).toMatch(/^min\(calc\(100%/);
  });

  it('no Back bar: the video sits under a black status bar and stays pinned while scrolling (portrait)', () => {
    expect(computed(['.watch.web'], 'padding-top', 390)).toBe('var(--safe-top)');
    expect(computed(['.watch.web::before'], 'height', 390)).toBe('var(--safe-top)');
    expect(computed(['.watch.web::before'], 'background', 390)).toBe('#000');
  });

  it('long links in the description wrap instead of widening the page', () => {
    expect(computed(['.description', '.watch.web .description'], 'overflow-wrap', 390)).toBe('anywhere');
  });
});

describe('preview player', () => {
  it("is cropped so YouTube's title bar and logos fall outside the card", () => {
    expect(computed(['.preview'], 'overflow', 390)).toBe('hidden');
    expect(computed(['.preview iframe'], 'height', 390)).toBe('200%');
    expect(computed(['.preview iframe'], 'top', 390)).toBe('-50%');
  });
});
