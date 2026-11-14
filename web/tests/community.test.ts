import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseBranding, cleanTitle, getBranding, getSkipSegments, SB_API, segmentAt } from '../src/community';
import { defaultSettings, saveSettings } from '../src/config';

afterEach(() => vi.unstubAllGlobals());

async function sha4(id: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 4);
}

describe('SponsorBlock', () => {
  it('asks with only a 4-character hash prefix (privacy) and keeps just this video', async () => {
    const f = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => [
        { videoID: 'other', segments: [{ segment: [1, 50], category: 'sponsor', UUID: 'x' }] },
        { videoID: 'vid123', segments: [
          { segment: [300, 360], category: 'selfpromo', UUID: 'b' },
          { segment: [60, 120], category: 'sponsor', UUID: 'a' },
          { segment: [10, 10.4], category: 'interaction', UUID: 'tiny' },
        ] },
      ],
    }));
    vi.stubGlobal('fetch', f);
    const segs = await getSkipSegments('vid123');
    const url = String(f.mock.calls[0][0]);
    expect(url.startsWith(`${SB_API}/api/skipSegments/${await sha4('vid123')}?`)).toBe(true);
    expect(url).not.toContain('vid123');
    expect(decodeURIComponent(url)).toContain('["sponsor","selfpromo","interaction"]');
    expect(segs.map((s) => s.id)).toEqual(['a', 'b']); // sorted, too-short ones dropped
    // cached: no second request
    await getSkipSegments('vid123');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('no segments known (404) or service down: just plays normally', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => [] })));
    expect(await getSkipSegments('none1')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await getSkipSegments('none2')).toEqual([]);
  });

  it('does nothing when turned off in Settings', async () => {
    saveSettings({ ...defaultSettings, skipSponsors: false });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await getSkipSegments('vid9')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('finds the segment you are in, once (so you can go back and watch it)', () => {
    const segs = [{ start: 60, end: 120, category: 'sponsor', id: 'a' }];
    expect(segmentAt(segs, 59, new Set())).toBeUndefined();
    expect(segmentAt(segs, 61, new Set())?.id).toBe('a');
    expect(segmentAt(segs, 61, new Set(['a']))).toBeUndefined();
    expect(segmentAt(segs, 119.8, new Set())).toBeUndefined(); // practically over
  });
});

describe('DeArrow', () => {
  it('uses the top community title and thumbnail when trusted', () => {
    expect(
      chooseBranding({
        titles: [{ title: 'How >TCP actually works', original: false, votes: 2, locked: false }],
        thumbnails: [{ timestamp: 42.5, original: false, votes: 0, locked: false }],
      }),
    ).toEqual({ title: 'How TCP actually works', thumbTime: 42.5 });
  });

  it('keeps YouTube’s own when the top one is the original, voted down, or missing', () => {
    expect(chooseBranding({ titles: [{ title: 'Orig', original: true, votes: 5, locked: false }] })).toEqual({ title: undefined, thumbTime: undefined });
    expect(chooseBranding({ titles: [{ title: 'Bad', original: false, votes: -1, locked: false }] }).title).toBeUndefined();
    expect(chooseBranding({ titles: [{ title: 'Locked', original: false, votes: -1, locked: true }] }).title).toBe('Locked');
    expect(chooseBranding({})).toEqual({ title: undefined, thumbTime: undefined });
  });

  it('removes the ">" keep-as-written markers', () => {
    expect(cleanTitle('>iPhone vs >Pixel camera test')).toBe('iPhone vs Pixel camera test');
  });

  it('looks each video up once and caches it', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ titles: [{ title: 'Clear title', original: false, votes: 1, locked: false }], thumbnails: [] }),
    }));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([getBranding('dv1'), getBranding('dv1')]);
    expect(a.title).toBe('Clear title');
    expect(b.title).toBe('Clear title');
    await getBranding('dv1');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
