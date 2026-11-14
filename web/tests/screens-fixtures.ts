import { ytVideo } from './youtube-mock';

/** A watched chess channel with one live stream, one upcoming stream and a normal upload. */
export function liveRoutes() {
  const vids: Record<string, ReturnType<typeof ytVideo>> = {
    live1: ytVideo({ id: 'live1', channelId: 'UCchess', title: 'Big tournament – round 5', duration: 'P0D', live: 'live' }),
    soon1: ytVideo({
      id: 'soon1',
      channelId: 'UCchess',
      title: 'Round 6 starts soon',
      duration: 'P0D',
      live: 'upcoming',
      scheduledStart: new Date(Date.now() + 3 * 3600_000).toISOString(),
    }),
    old1: ytVideo({ id: 'old1', channelId: 'UCchess', title: 'Round 4 replay', duration: 'PT3H' }),
  };
  return {
    channels: (p: URLSearchParams) =>
      p.get('forHandle')
        ? { items: [{ id: 'UCchess' }] }
        : { items: (p.get('id') || '').split(',').filter(Boolean).map((id) => ({ id, snippet: { title: id, thumbnails: {} }, contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } } })) },
    playlistItems: () => ({ items: Object.keys(vids).map((id) => ({ contentDetails: { videoId: id } })) }),
    videos: (p: URLSearchParams) => {
      if (p.get('myRating')) return { items: [] };
      if (p.get('chart')) return { items: [] };
      return { items: (p.get('id') || '').split(',').map((id) => vids[id]).filter(Boolean) };
    },
    'videos/getRating': () => ({ items: [{ rating: 'none' }] }),
    subscriptions: () => ({ items: [] }),
    videoCategories: () => ({ items: [] }),
    search: () => ({ items: [] }),
  };
}

/** A stand-in for YouTube's iframe player that records what the app asks it to do. */
export function installFakePlayer() {
  const players: FakePlayer[] = [];
  class FakePlayer {
    state = 1; // playing
    time = 100;
    opts: any;
    calls: string[] = [];
    constructor(_el: unknown, opts: any) {
      this.opts = opts;
      players.push(this);
      queueMicrotask(() => opts.events?.onReady?.({ target: this }));
    }
    playVideo() { this.calls.push('play'); this.state = 1; }
    mute() { this.calls.push('mute'); }
    stopVideo() { this.calls.push('stop'); }
    /** Test helper: pretend YouTube reported a state change (1 playing, 0 ended). */
    emit(state: number) { this.state = state; this.opts.events?.onStateChange?.({ data: state, target: this }); }
    fail(code = 150) { this.opts.events?.onError?.({ data: code, target: this }); }
    pauseVideo() { this.calls.push('pause'); this.state = 2; }
    seekTo(t: number) { this.calls.push(`seek:${t}`); this.time = t; }
    loadVideoById(id: string) { this.calls.push(`load:${id}`); }
    getPlayerState() { return this.state; }
    getCurrentTime() { return this.time; }
    getDuration() { return 600; }
    destroyed = false;
    destroy() { this.destroyed = true; }
  }
  (window as any).YT = { Player: FakePlayer };
  return players;
}
