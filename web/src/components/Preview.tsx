import { useEffect, useRef, useState } from 'react';
import { loadYTApi } from '../yt';

export const PREVIEW_MAX_MS = 60_000;

/**
 * A muted, control-less YouTube player laid over a thumbnail.
 * It stays invisible until the video is really playing, so you never see
 * a black box or an "unavailable" message, and it stops after a minute.
 */
export function Preview({ id }: { id: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let player: any;
    let gone = false;
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
            if (e.data === 1) setPlaying(true);
            if (e.data === 0) setDone(true);
          },
          onError: () => setDone(true),
        },
      });
    });
    return () => {
      gone = true;
      window.clearTimeout(stop);
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
