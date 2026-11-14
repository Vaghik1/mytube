import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHistory, mergeWatches, recordWatch, type Watch } from '../src/history';
import { clearHistoryEverywhere, syncHistory } from '../src/historySync';
import { mergeHistory } from '../api/hub';
import { signIn } from './youtube-mock';

const w = (id: string, at: number, extra: Partial<Watch> = {}): Watch => ({ id, ch: 'c', cht: 'C', title: id, sec: 10, dur: 600, at, ...extra });
const video = (id: string) => ({ id, title: id, channelId: 'c', channelTitle: 'C', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false });

describe('merging two devices’ histories', () => {
  it('newest copy wins; time watched never goes down', () => {
    const tv = [w('a', 200, { pos: 300, sec: 300 })];
    const phone = [w('a', 100, { pos: 50, sec: 500, liked: true })];
    const [m] = mergeWatches(tv, phone);
    expect(m.pos).toBe(300); // where you stopped most recently (TV)
    expect(m.sec).toBe(500); // most time watched anywhere
    expect(m.at).toBe(200);
  });

  it('a later "Not interested" wins over an earlier watch', () => {
    const [m] = mergeWatches([w('a', 100)], [w('a', 200, { skip: true })]);
    expect(m.skip).toBe(true);
  });

  it('the server uses exactly the same rules', () => {
    const a = [w('a', 200, { pos: 300, sec: 300 }), w('b', 50)];
    const b = [w('a', 100, { pos: 50, sec: 500, opens: 2 }), w('c', 70)];
    expect(mergeHistory(a as any, b as any)).toEqual(mergeWatches(a, b));
  });
});

describe('syncing with the server', () => {
  let server: { items: Watch[]; cleared: number };
  let bodies: any[];
  beforeEach(() => {
    signIn();
    server = { items: [], cleared: 0 };
    bodies = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('/api/history');
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (body.action === 'clear') {
          server = { items: [], cleared: Date.now() };
        } else {
          server.items = mergeHistory(server.items as any, body.items) as any;
        }
        const items = body.since ? server.items.filter((x) => x.at > body.since - 600_000) : server.items;
        return new Response(JSON.stringify({ items, cleared: server.cleared }), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends what you watched and gets what the other device watched', async () => {
    recordWatch(video('here') as any, 120, 120);
    server.items = [w('there', Date.now() - 1000, { pos: 400, sec: 400 })];
    await syncHistory();
    expect(bodies[0].items.map((x: Watch) => x.id)).toEqual(['here']);
    expect(loadHistory().map((x) => x.id).sort()).toEqual(['here', 'there']);
    expect(server.items.map((x) => x.id).sort()).toEqual(['here', 'there']);
  });

  it('next time sends only new changes', async () => {
    recordWatch(video('one') as any, 120, 120);
    await syncHistory();
    await syncHistory();
    expect(bodies[1].items).toEqual([]);
    expect(bodies[1].since).toBeGreaterThan(0);
  });

  it('clearing history on one device clears it on the other', async () => {
    recordWatch(video('old') as any, 120, 120);
    await syncHistory();
    // the other device clears…
    server = { items: [], cleared: Date.now() + 1 };
    await syncHistory();
    expect(loadHistory()).toEqual([]);
  });

  it('“Clear watch history” here clears it on the server too', async () => {
    await clearHistoryEverywhere();
    expect(bodies.at(-1)).toEqual({ action: 'clear' });
    expect(server.cleared).toBeGreaterThan(0);
  });
});
