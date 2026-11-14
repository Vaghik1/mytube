import { beforeEach, describe, expect, it } from 'vitest';
import { getLiveNow, getPicks } from '../src/agent';
import { loadRemotePrefs, saveRemotePrefs } from '../src/config';
import { calls, mockYouTube, signIn, ytVideo } from './youtube-mock';

beforeEach(() => signIn());

const base = {
  subscriptions: () => ({ items: [] }),
  channels: () => ({ items: [] }),
  playlistItems: () => ({ items: [] }),
};

describe('assistant hub client', () => {
  it("stores ChatGPT's preferences that come with the picks", async () => {
    mockYouTube(base, { '/api/picks': () => ({ picks: [], preferences: { interests: ['chess'], hideShorts: true } }) });
    await getPicks(true);
    expect(loadRemotePrefs()).toMatchObject({ interests: ['chess'], hideShorts: true, liveTopics: [] });
  });
});

describe('live topics', () => {
  it('finds streams live right now for a topic, and caches the search', async () => {
    saveRemotePrefs({ liveTopics: ['chess tournament'] });
    const f = mockYouTube(
      {
        ...base,
        search: (p) => {
          expect(p.get('eventType')).toBe('live');
          return { items: [{ id: { videoId: 'live-a' } }, { id: { videoId: 'ended-b' } }] };
        },
        videos: (p) => ({
          items: p
            .get('id')!
            .split(',')
            .map((id) => ytVideo({ id, channelId: 'x', live: id.startsWith('live') ? 'live' : 'none', duration: 'P0D' })),
        }),
      },
      { '/api/picks': () => ({ picks: [] }) },
    );
    const first = await getLiveNow(true);
    expect(first.live.map((v) => v.id)).toEqual(['live-a']); // ended stream is not shown as live
    await getLiveNow(true);
    expect(calls(f, 'search')).toHaveLength(1);
  });

  it('searches at most 3 live topics', async () => {
    saveRemotePrefs({ liveTopics: ['a', 'b', 'c', 'd'] });
    const f = mockYouTube({ ...base, search: () => ({ items: [] }), videos: () => ({ items: [] }) }, { '/api/picks': () => ({ picks: [] }) });
    await getLiveNow(true);
    expect(calls(f, 'search')).toHaveLength(3);
  });
});
