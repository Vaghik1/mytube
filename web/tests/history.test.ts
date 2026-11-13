import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../src/api';
import {
  buildProfile,
  clearHistory,
  isSeen,
  loadHistory,
  markLiked,
  notInterested,
  recordWatch,
  seedQuery,
  seenIds,
  tokens,
} from '../src/history';

const vid = (id: string, channelId: string, title: string, duration = 600, tags: string[] = []): Video => ({
  id,
  title,
  channelId,
  channelTitle: `${channelId} channel`,
  publishedAt: new Date().toISOString(),
  thumb: '',
  duration,
  views: 0,
  likes: 0,
  live: false,
  description: '',
  categoryId: '20',
  tags,
});

afterEach(() => vi.useRealTimers());

describe('recording watches', () => {
  it('ignores accidental opens under 3 seconds', () => {
    recordWatch(vid('a', 'c1', 'Chess opening'), 2);
    expect(loadHistory()).toHaveLength(0);
  });

  it('stores the longest watch time for a video', () => {
    recordWatch(vid('a', 'c1', 'Chess opening'), 100);
    recordWatch(vid('a', 'c1', 'Chess opening'), 40);
    const [w] = loadHistory();
    expect(w.sec).toBe(100);
    expect(w.ch).toBe('c1');
  });

  it('keeps the newest first and caps the history', () => {
    for (let i = 0; i < 850; i++) recordWatch(vid(`v${i}`, 'c', `Video ${i}`), 30);
    const list = loadHistory();
    expect(list.length).toBeLessThanOrEqual(800);
  });

  it('records likes and "not interested"', () => {
    const v = vid('a', 'c1', 'Chess opening');
    markLiked(v, true);
    expect(loadHistory()[0].liked).toBe(true);
    notInterested(v);
    expect(loadHistory()[0].skip).toBe(true);
  });

  it('clears everything', () => {
    recordWatch(vid('a', 'c1', 'x video'), 30);
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});

describe('seen videos', () => {
  it('counts a video as seen after half of it (or 90s)', () => {
    expect(isSeen({ id: 'a', ch: 'c', cht: '', title: '', sec: 40, dur: 60, at: 0 })).toBe(true);
    expect(isSeen({ id: 'a', ch: 'c', cht: '', title: '', sec: 20, dur: 60, at: 0 })).toBe(false);
    expect(isSeen({ id: 'a', ch: 'c', cht: '', title: '', sec: 95, dur: 3600, at: 0 })).toBe(true);
  });

  it('treats "not interested" as seen', () => {
    notInterested(vid('x', 'c', 'Gossip'));
    expect(seenIds().has('x')).toBe(true);
  });
});

describe('taste profile', () => {
  it('ranks channels you watch fully above ones you skip', () => {
    recordWatch(vid('a', 'chess', 'Magnus blitz chess', 600), 590);
    recordWatch(vid('b', 'chess', 'Chess endgame tricks', 300), 290);
    recordWatch(vid('c', 'cooking', 'Pasta in 5 minutes', 300), 8);
    const p = buildProfile();
    expect(p.channels[0].id).toBe('chess');
    expect(p.channels.find((c) => c.id === 'cooking')).toBeUndefined(); // negative score dropped
  });

  it('turns "not interested" into a negative signal', () => {
    recordWatch(vid('a', 'gossip', 'Celebrity news', 600), 300);
    notInterested(vid('b', 'gossip', 'More celebrity news'));
    notInterested(vid('c', 'gossip', 'Even more celebrity news'));
    expect(buildProfile().channels.find((c) => c.id === 'gossip')).toBeUndefined();
  });

  it('likes outweigh plain watches', () => {
    recordWatch(vid('a', 'one', 'Alpha topic', 600), 300);
    recordWatch(vid('b', 'two', 'Beta topic', 600), 300);
    markLiked(vid('b', 'two', 'Beta topic', 600), true);
    expect(buildProfile().channels[0].id).toBe('two');
  });

  it('fades old watches (14-day half-life)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    recordWatch(vid('old', 'old', 'Old interest', 600), 600);
    vi.setSystemTime(new Date('2026-03-01'));
    recordWatch(vid('new', 'new', 'New interest', 600), 300);
    expect(buildProfile().channels[0].id).toBe('new');
  });

  it('collects topics from titles and tags, without filler words', () => {
    recordWatch(vid('a', 'c', 'The best chess openings for you', 600, ['Sicilian Defense']), 500);
    const terms = buildProfile().terms.map((t) => t.term);
    expect(terms).toEqual(expect.arrayContaining(['chess', 'openings', 'sicilian', 'defense']));
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('you');
  });

  it('picks enjoyed videos as seeds and builds a search phrase from them', () => {
    recordWatch(vid('a', 'c', 'Magnus Carlsen chess blitz', 600), 550);
    recordWatch(vid('b', 'c', 'Random clip', 600), 30);
    const p = buildProfile();
    expect(p.seeds.map((s) => s.id)).toEqual(['a']);
    const q = seedQuery(p.seeds[0], p);
    expect(q.split(' ').length).toBeLessThanOrEqual(3);
    expect(q).toMatch(/chess|magnus|carlsen|blitz/);
  });
});

describe('tokens', () => {
  it('handles non-Latin titles', () => {
    expect(tokens('Карлсен Непомнящий 2026')).toEqual(['карлсен', 'непомнящий']);
  });
  it('drops short words and plain numbers', () => {
    expect(tokens('a an 42 go chess')).toEqual(['chess']);
  });
});
