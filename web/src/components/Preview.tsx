import { useEffect, useRef, useState } from 'react';
import { loadYTApi } from '../yt';
import { clearPreviewPos, savePreviewPos, startPoint } from '../history';

/** How often a playing preview remembers where it is. */
export const SAVE_EVERY_MS = 2000;
/**
 * YouTube shows its title, a big pause button and logos when a player starts, and hides them
 * by itself after about 2–3 seconds of playing. The thumbnail stays up until then.
 * (Cropping them away instead also cut off the subtitles, which sit at the very bottom.)
 */
export const REVEAL_AFTER_MS = 2500;
/** How often the preview checks on the player. */
export const TICK_MS = 250;
/** If YouTube hasn't started playing by itself, nudge it again this often. */
const NUDGE_EVERY_MS = 1000;

/**
 * A muted, control-less YouTube player laid over a thumbnail, with subtitles when the video has them.
 * It stays invisible until it has actually played for a moment, so you never see a black box,
 * an "unavailable" message or YouTube's start-up overlays. It plays to the end, and remembers
 * where it got to: the next preview of this video — and the video itself — continue from there.
 */
export function Preview({ id }: { id: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let player: any;
    let gone = false;
    let ready = false;
    let playedMs = 0;
    let sinceNudge = 0;
    let sinceSave = 0;
    const from = startPoint(id);
    let ended = false;
    const remember = () => {
      if (ended) return;
      try {
        const t = player?.getCurrentTime?.();
        if (playedMs > 0 && t > 0) savePreviewPos(id, t, player.getDuration?.() || 0);
      } catch {
        /* ignore */
      }
    };

    // Count only time actually spent playing (short buffering pauses don't start the wait over),
    // and if the player is stuck before starting, ask it to play again.
    const tick = window.setInterval(() => {
      if (!ready || !player?.getPlayerState) return;
      const state = player.getPlayerState();
      if (state === 1) {
        playedMs += TICK_MS;
        if (playedMs >= REVEAL_AFTER_MS) setPlaying(true);
        sinceSave += TICK_MS;
        if (sinceSave >= SAVE_EVERY_MS) {
          sinceSave = 0;
          remember();
        }
      } else if (playedMs === 0 && state !== 3) {
        sinceNudge += TICK_MS;
        if (sinceNudge >= NUDGE_EVERY_MS) {
          sinceNudge = 0;
          try {
            player.mute();
            player.playVideo();
          } catch {
            /* ignore */
          }
        }
      }
    }, TICK_MS);

    const subtitlesOn = () => {
      try {
        player?.setOption?.('captions', 'track', { languageCode: 'en' });
      } catch {
        /* the video has no subtitles */
      }
    };

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
          ...(from ? { start: Math.floor(from.pos) } : {}),
          mute: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          iv_load_policy: 3,
          cc_load_policy: 1, // subtitles on (when the video has them)
          cc_lang_pref: 'en',
          playsinline: 1,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            ready = true;
            e.target.mute();
            e.target.playVideo();
          },
          onApiChange: subtitlesOn,
          onStateChange: (e: any) => {
            if (e.data === 1 && playedMs === 0) subtitlesOn();
            if (e.data === 0) {
              ended = true;
              clearPreviewPos(id); // played to the end
              setDone(true);
            }
          },
          onError: () => setDone(true),
        },
      });
    });
    return () => {
      gone = true;
      window.clearInterval(tick);
      remember(); // scrolled away: keep the spot
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
