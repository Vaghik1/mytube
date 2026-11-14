import { useEffect, useRef, useState } from 'react';
import { loadYTApi } from '../yt';

export const PREVIEW_MAX_MS = 60_000;
/** YouTube shows a title, a big play/pause button and logos for the first moments: wait them out. */
export const REVEAL_AFTER_MS = 2500;

/**
 * A muted, control-less YouTube player laid over a thumbnail.
 * It stays invisible until the video has been playing for a moment, so you never see
 * a black box, an "unavailable" message or YouTube's start-up overlays; it stops after a minute.
 * The player is twice as tall as the thumbnail (video centred), so YouTube's title bar
 * and corner logo land outside the visible area.
 */
export function Preview({ id }: { id: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let player: any;
    let gone = false;
    let reveal = 0;
    const stop = window.setTimeout(() => {
      setDone(true);
      try {
        player?.stopVideo?.();
      } catch {
        /* ignore */
      }
    }, PREVIEW_MAX_MS);
    loadYTApi().then(() => {
      if (gone || !holder.current) return;
      const el = document.createElement('div');
      holder.current.appendChild(el);
      player = new window.YT.Player(el, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            e.target.mute();
            e.target.playVideo();
          },
          onStateChange: (e: any) => {
            if (e.data === 1) {
              if (!reveal) reveal = window.setTimeout(() => setPlaying(true), REVEAL_AFTER_MS);
            } else if (e.data !== 1) {
              window.clearTimeout(reveal); // buffering or paused: wait again before showing
              reveal = 0;
            }
            if (e.data === 0) setDone(true);
          },
          onError: () => setDone(true),
        },
      });
    });
    return () => {
      gone = true;
      window.clearTimeout(stop);
      window.clearTimeout(reveal);
      try {
        player?.destroy?.();
      } catch {
        /* ignore */
      }
    };
  }, [id]);

  if (done) return null;
  return <div className={`preview${playing ? ' playing' : ''}`} ref={holder} aria-hidden="true" />;
}
