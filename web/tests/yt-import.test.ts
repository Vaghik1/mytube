// Importing what you watched in YouTube itself (Google Takeout) and using it in For you.
import { deflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { getForYou, clearCache, youtubePrior, type Video } from '../src/api';
import { buildProfile, importWatches, IMPORT_MAX, loadHistory, recordWatch, seenIds } from '../src/history';
import { importTakeoutFile, parseTakeout, unzipFile } from '../src/ytImport';
import { mockYouTube, signIn, ytVideo } from './youtube-mock';

beforeEach(() => signIn());

const UC = (c: string) => 'UC' + c.padEnd(22, 'x');
const day = 86400_000;
const entry = (id: string, ch: string, daysAgo: number, title = 'Some video') => ({
  header: 'YouTube',
  title: `Watched ${title}`,
  titleUrl: `https://www.youtube.com/watch?v=${id}`,
  subtitles: [{ name: `${ch} channel`, url: `https://www.youtube.com/channel/${UC(ch)}` }],
  time: new Date(Date.now() - daysAgo * day).toISOString(),
  products: ['YouTube'],
});

/** A real .zip (one deflated file), like the one Takeout gives you. */
function zipOf(name: string, text: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(text));
  const nameB = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(text.length, 22);
  local.writeUInt16LE(nameB.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(text.length, 24);
  central.writeUInt16LE(nameB.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = 30 + nameB.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameB.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return new Uint8Array(Buffer.concat([local, nameB, data, central, nameB, end]));
}

describe('reading a Google Takeout watch history', () => {
  it('takes watched videos and leaves out ads, YouTube Music and removed videos', () => {
    const list = parseTakeout([
      entry('aaaaaaaaaaa', 'fav', 1, 'Chess slowrun 55'),
      { ...entry('bbbbbbbbbbb', 'ad', 1), details: [{ name: 'From Google Ads' }] },
      { ...entry('ccccccccccc', 'music', 1), header: 'YouTube Music' },
      { header: 'YouTube', title: 'Watched a video that has been removed', time: new Date().toISOString() },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'aaaaaaaaaaa', ch: UC('fav'), cht: 'fav channel', title: 'Chess slowrun 55' });
  });

  it('reads the .zip Takeout gives you', async () => {
    const zip = zipOf('Takeout/YouTube and YouTube Music/history/watch-history.json', JSON.stringify([entry('aaaaaaaaaaa', 'fav', 1)]));
    expect(new TextDecoder().decode((await unzipFile(zip, 'watch-history.json'))!)).toContain('aaaaaaaaaaa');
    const r = await importTakeoutFile(new Blob([zip as Uint8Array<ArrayBuffer>]));
    expect(r).toEqual({ found: 1, added: 1 });
  });

  it('explains what to do with an HTML export', async () => {
    const zip = zipOf('Takeout/YouTube and YouTube Music/history/watch-history.html', '<html></html>');
    await expect(importTakeoutFile(new Blob([zip as Uint8Array<ArrayBuffer>]))).rejects.toThrow(/JSON/);
    await expect(importTakeoutFile(new Blob(['<html><body>'], { type: 'text/html' }))).rejects.toThrow(/JSON/);
  });
});

describe('imported YouTube watches in your history', () => {
  it('are added once, keep their real time for taste, and sync (they count as just changed)', () => {
    recordWatch({ id: 'mytubewatch', title: 't', channelId: 'c', channelTitle: 'c', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false, description: '' }, 300);
    const n = importWatches(parseTakeout([entry('mytubewatch', 'c', 1), entry('ddddddddddd', 'fav', 10), entry('eeeeeeeeeee', 'fav', 400)]));
    expect(n).toBe(1); // already in MyTube; too old (over 4 months)
    const w = loadHistory().find((x) => x.id === 'ddddddddddd')!;
    expect(w).toMatchObject({ yt: true, ch: UC('fav') });
    expect(Date.now() - w.t!).toBeGreaterThan(9 * day); // when you watched it
    expect(Date.now() - w.at).toBeLessThan(1000); // when it was imported (so it syncs to the TV)
    expect(importWatches(parseTakeout([entry('ddddddddddd', 'fav', 10)]))).toBe(0); // no duplicates
  });

  it("aren't suggested again, and teach MyTube your channels", () => {
    importWatches(parseTakeout([1, 2, 3].map((d) => entry(`fav${d}`.padEnd(11, '0'), 'fav', d))));
    expect(seenIds().has('fav10000000')).toBe(true);
    expect(buildProfile().channels[0]).toMatchObject({ id: UC('fav') });
  });

  it(`keeps at most the ${IMPORT_MAX} most recent`, () => {
    const many = Array.from({ length: IMPORT_MAX + 50 }, (_, i) => entry(`v${String(i).padStart(10, '0')}`, 'fav', 1 + i / 100));
    expect(importWatches(parseTakeout(many))).toBe(IMPORT_MAX);
  });
});

describe("what YouTube shares about your taste", () => {
  const vid = (channelId: string): Video => ({ id: 'x', title: '', channelId, channelTitle: '', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false, description: '' });
  it("gives channels you liked videos of, and your most relevant subscriptions, a head start", () => {
    const p = youtubePrior([{ id: 'top' }, { id: 'second' }], [vid('liked'), vid('liked'), vid('liked'), vid('once')]);
    expect(p.get('liked')).toBeCloseTo(0.8);
    expect(p.get('once')).toBeCloseTo(0.3);
    expect(p.get('top')).toBeCloseTo(0.6);
    expect(p.get('second')).toBeLessThan(0.6);
  });
});

describe('For you with your YouTube history imported', () => {
  it("a channel you watch every video of in YouTube leads with its new video", async () => {
    const pub = (d: number) => new Date(Date.now() - d * day).toISOString();
    const vids: Record<string, Parameters<typeof ytVideo>[0]> = {};
    const add = (id: string, channelId: string, days: number) => (vids[id] = { id, channelId, title: 'chess lesson', publishedAt: pub(days) });
    const fav = UC('fav');
    add('favnew00000', fav, 0.1);
    for (const w of [1, 2, 3, 4]) add(`fav${w}`.padEnd(11, '0'), fav, w * 7);
    add('bignew00000', 'big', 0.1);
    add('biga0000000', 'big', 2);
    add('bigb0000000', 'big', 3);
    // In MyTube (a few days) you watched 4 videos of "big"…
    for (let i = 1; i <= 4; i++)
      recordWatch({ id: `bigold${i}`, title: 'chess lesson', channelId: 'big', channelTitle: 'big', publishedAt: '', thumb: '', duration: 600, views: 0, likes: 0, live: false, description: '' }, 590);
    // …but in YouTube you watched every recent video of "fav".
    importWatches(parseTakeout([1, 2, 3, 4].map((w) => entry(`fav${w}`.padEnd(11, '0'), 'fav', w * 7 - 1, 'chess lesson'))));
    const uploads = (ch: string) => Object.keys(vids).filter((id) => vids[id].channelId === ch);
    mockYouTube(
      {
        subscriptions: () => ({ items: [fav, 'big'].map((c) => ({ snippet: { resourceId: { channelId: c }, title: c, thumbnails: {} } })) }),
        channels: (p: URLSearchParams) => ({ items: p.get('id')!.split(',').map((id) => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })) }),
        playlistItems: (p: URLSearchParams) => ({ items: uploads(p.get('playlistId')!.replace('UU-', '')).map((id) => ({ contentDetails: { videoId: id, videoPublishedAt: vids[id].publishedAt } })) }),
        videos: (p: URLSearchParams) => (p.get('myRating') ? { items: [] } : { items: p.get('id')!.split(',').filter((id) => vids[id]).map((id) => ytVideo(vids[id])) }),
        search: () => ({ items: [] }),
      },
      { '/api/picks': () => ({ picks: [] }) },
    );
    for (let i = 0; i < 5; i++) {
      clearCache('fy.');
      const ids = (await getForYou()).map((x) => x.id);
      expect(ids[0]).toBe('favnew00000');
      expect(ids.some((id) => id.startsWith('fav') && id !== 'favnew00000')).toBe(false); // already seen in YouTube
    }
  });
});
