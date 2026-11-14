import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Channel } from '../src/pages/Channel';
import { Subscriptions } from '../src/pages/Subscriptions';
import { calls, mockYouTube, signIn, ytVideo } from './youtube-mock';

beforeEach(() => signIn());
afterEach(() => cleanup());

type Sub = { subId: string; id: string; title: string };
const SUBS: Sub[] = [
  { subId: 's-zeta', id: 'UCzeta', title: 'Zeta Chess' },
  { subId: 's-alpha', id: 'UCalpha', title: 'Alpha Physics' },
  { subId: 's-mid', id: 'UCmid', title: 'Mid Tennis' },
];

/** Fake YouTube with a subscriptions list that really changes on subscribe/unsubscribe. */
function youtube({ failDelete = new Set<string>() } = {}) {
  let subs = [...SUBS];
  const f = mockYouTube({
    subscriptions: (p, init) => {
      const method = init?.method || 'GET';
      if (method === 'DELETE') {
        const id = p.get('id')!;
        if (failDelete.has(id)) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 });
        subs = subs.filter((s) => s.subId !== id);
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') {
        const channelId = JSON.parse(String(init!.body)).snippet.resourceId.channelId;
        subs.unshift({ subId: `s-new-${channelId}`, id: channelId, title: channelId });
        return { id: `s-new-${channelId}` };
      }
      // two pages, to check paging
      const page = p.get('pageToken') === 'p2' ? subs.slice(2) : subs.slice(0, 2);
      return {
        items: page.map((s) => ({ id: s.subId, snippet: { title: s.title, resourceId: { channelId: s.id }, thumbnails: {} } })),
        nextPageToken: p.get('pageToken') ? undefined : subs.length > 2 ? 'p2' : undefined,
      };
    },
    search: (p) =>
      p.get('type') === 'channel'
        ? { items: [{ id: { channelId: 'UCgotham' } }, { id: { channelId: 'UCzeta' } }] }
        : { items: [{ id: { videoId: 'pop1' } }, { id: { videoId: 'pop2' } }] },
    channels: (p) => ({
      items: p
        .get('id')!
        .split(',')
        .map((id) => ({
          id,
          snippet: { title: id === 'UCgotham' ? 'GothamChess' : id, thumbnails: {} },
          statistics: { subscriberCount: '5200000', videoCount: '10' },
          contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } },
        })),
    }),
    playlistItems: () => ({ items: [{ contentDetails: { videoId: 'new1' } }] }),
    videos: (p) => ({ items: p.get('id')!.split(',').map((id) => ytVideo({ id, channelId: 'UCzeta', title: `Video ${id}` })) }),
  });
  return f;
}

function ChannelStub() {
  return <div>Channel page {useParams().id}</div>;
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/subscriptions']}>
      <Routes>
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/channel/:id" element={<ChannelStub />} />
      </Routes>
    </MemoryRouter>,
  );
const titles = () => [...document.querySelectorAll('.sub-list:last-of-type .sub-title')].map((e) => e.textContent);

describe('Subscriptions page', () => {
  it('lists all your subscriptions (no videos), across pages', async () => {
    youtube();
    renderPage();
    expect(await screen.findByText('Your subscriptions (3)')).toBeTruthy();
    expect(titles()).toEqual(['Zeta Chess', 'Alpha Physics', 'Mid Tennis']);
    expect(document.querySelector('.grid')).toBeNull(); // no video grid
  });

  it('sorts A–Z', async () => {
    youtube();
    renderPage();
    await screen.findByText('Your subscriptions (3)');
    fireEvent.click(screen.getByText('A–Z'));
    expect(titles()).toEqual(['Alpha Physics', 'Mid Tennis', 'Zeta Chess']);
  });

  it('opens a channel when you tap it', async () => {
    youtube();
    renderPage();
    fireEvent.click(await screen.findByText('Alpha Physics'));
    expect(await screen.findByText('Channel page UCalpha')).toBeTruthy();
  });

  it('removes several channels at once, only after confirming', async () => {
    const f = youtube();
    renderPage();
    await screen.findByText('Your subscriptions (3)');
    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(screen.getByText('Zeta Chess'));
    fireEvent.click(screen.getByText('Mid Tennis'));
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.click(screen.getByText('Unsubscribe (2)'));
    expect(calls(f, 'subscriptions').filter((u, i) => (f.mock.calls[i]?.[1] as RequestInit)?.method === 'DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByText('Confirm: unsubscribe 2'));

    await screen.findByText('Unsubscribed from 2 channels.');
    const deleted = f.mock.calls
      .filter(([, init]) => (init as RequestInit)?.method === 'DELETE')
      .map(([u]) => new URL(String(u)).searchParams.get('id'));
    expect(deleted.sort()).toEqual(['s-mid', 's-zeta']);
    expect(titles()).toEqual(['Alpha Physics']);
    expect(screen.getByText('Your subscriptions (1)')).toBeTruthy();
  });

  it('keeps channels that failed to unsubscribe and says so', async () => {
    youtube({ failDelete: new Set(['s-mid']) });
    renderPage();
    await screen.findByText('Your subscriptions (3)');
    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(screen.getByText('Select all'));
    fireEvent.click(screen.getByText('Unsubscribe (3)'));
    fireEvent.click(screen.getByText('Confirm: unsubscribe 3'));
    await screen.findByText(/Unsubscribed from 2 of 3/);
    expect(titles()).toEqual(['Mid Tennis']);
  });

  it('changing the selection cancels a pending confirmation', async () => {
    youtube();
    renderPage();
    await screen.findByText('Your subscriptions (3)');
    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(screen.getByText('Zeta Chess'));
    fireEvent.click(screen.getByText('Unsubscribe (1)'));
    fireEvent.click(screen.getByText('Alpha Physics'));
    expect(screen.getByText('Unsubscribe (2)')).toBeTruthy();
  });

  it('finds new channels and subscribes to them', async () => {
    const f = youtube();
    renderPage();
    await screen.findByText('Your subscriptions (3)');
    fireEvent.change(screen.getByPlaceholderText('Find channels to subscribe'), { target: { value: 'gotham' } });
    fireEvent.click(screen.getByText('Search'));
    const row = (await screen.findByText('GothamChess')).closest('.sub-row') as HTMLElement;
    expect(within(row).getByText('5.2M subscribers')).toBeTruthy();
    // a channel you already follow shows as subscribed
    const zetaRow = screen.getAllByText('UCzeta')[0].closest('.sub-row') as HTMLElement;
    expect(within(zetaRow).getByText('Subscribed ✓')).toBeTruthy();

    fireEvent.click(within(row).getByText('Subscribe'));
    await screen.findByText('Subscribed to GothamChess.');
    const post = f.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body)).snippet.resourceId.channelId).toBe('UCgotham');
    expect(screen.getByText('Your subscriptions (4)')).toBeTruthy();
    expect(within(row).getByText('Subscribed ✓')).toBeTruthy();
  });
});

describe('Channel page sorting', () => {
  const renderChannel = () =>
    render(
      <MemoryRouter initialEntries={['/channel/UCzeta']}>
        <Routes>
          <Route path="/channel/:id" element={<Channel />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the latest uploads first by default', async () => {
    const f = youtube();
    renderChannel();
    expect(await screen.findByText('Video new1')).toBeTruthy();
    expect(screen.getByText('Latest').className).toContain('active');
    expect(calls(f, 'search')).toHaveLength(0);
  });

  it('switches to most popular (most viewed) videos', async () => {
    const f = youtube();
    renderChannel();
    await screen.findByText('Video new1');
    fireEvent.click(screen.getByText('Most popular'));
    expect(await screen.findByText('Video pop1')).toBeTruthy();
    const s = calls(f, 'search')[0].searchParams;
    expect(s.get('order')).toBe('viewCount');
    expect(s.get('channelId')).toBe('UCzeta');
    await waitFor(() => expect(screen.queryByText('Video new1')).toBeNull());
  });
});
