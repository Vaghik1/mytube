import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getChannelVideos, getRating, getVideo, getVideos, rate, type Video } from '../api';
import { loadSettings } from '../config';
import { markLiked, notInterested, recordWatch } from '../history';
import { dismissPick } from '../agent';
import { SubscribeButton } from './Channel';
import type { Queue } from '../components/VideoCard';
import { VideoGrid } from '../components/VideoGrid';
import { focusFirst, isTouch, openInYouTube, pushBackHandler, pushKeyHandler } from '../tv';
import { fmtCount, fmtDuration, timeAgo } from '../util';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const ERRORS: Record<number, string> = {
  2: 'This video link is invalid.',
  5: 'This video cannot be played in this player.',
  100: 'This video was removed or is private.',
  101: 'The owner does not allow this video to play outside YouTube.',
  150: 'The owner does not allow this video to play outside YouTube.',
  153: 'YouTube refused to play this video here.',
};

type Mode = 'player' | 'details';

export function Watch() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const queue = (location.state as { queue?: Queue } | null)?.queue;

  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [video, setVideo] = useState<Video>();
  const [mode, setMode] = useState<Mode>('player');
  const [osd, setOsd] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ cur: 0, dur: 0 });
  const [error, setError] = useState<number | null>(null);
  const [rating, setRating] = useState<'like' | 'dislike' | 'none'>('none');
  const [upNext, setUpNext] = useState<Video[]>([]);
  const osdTimer = useRef<number>(0);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const errorRef = useRef(error);
  errorRef.current = error;

  const nextIndex = queue && queue.index + 1 < queue.ids.length ? queue.index + 1 : -1;

  const showOsd = () => {
    setOsd(true);
    window.clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => {
      if (player.current?.getPlayerState?.() === 1) setOsd(false);
    }, 4000);
  };

  const goNext = () => {
    if (queue && nextIndex >= 0) {
      nav(`/watch/${queue.ids[nextIndex]}`, { replace: true, state: { queue: { ...queue, index: nextIndex } } });
      return true;
    }
    return false;
  };
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  // Create the player once.
  useEffect(() => {
    let destroyed = false;
    loadYTApi().then(() => {
      if (destroyed || !holder.current) return;
      const el = document.createElement('div');
      holder.current.appendChild(el);
      player.current = new window.YT.Player(el, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          // TV: our own remote-friendly controls. Phone: YouTube's normal tap controls.
          controls: isTouch ? 1 : 0,
          disablekb: isTouch ? 0 : 1,
          fs: isTouch ? 1 : 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            setReady(true);
            e.target.playVideo();
          },
          onStateChange: (e: any) => {
            setPlaying(e.data === 1);
            if (e.data === 1) setError(null);
            if (e.data === 0) {
              if (!(loadSettings().autoplayNext && goNextRef.current())) setMode('details');
            }
            if (e.data !== 1) setOsd(true);
          },
          onError: (e: any) => setError(e.data),
        },
      });
    });
    return () => {
      destroyed = true;
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load video data + switch player when the id changes.
  useEffect(() => {
    setVideo(undefined);
    setError(null);
    setMode('player');
    setRating('none');
    showOsd();
    if (ready) player.current?.loadVideoById(id);
    getVideo(id).then(setVideo).catch(() => {});
    getRating(id).then(setRating).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // "Up next": the rest of the list you came from, otherwise more from this channel.
  useEffect(() => {
    if (!video) return;
    let alive = true;
    const load = queue && nextIndex >= 0
      ? getVideos(queue.ids.slice(nextIndex, nextIndex + 24))
      : getChannelVideos(video.channelId).then((p) => p.items.filter((v) => v.id !== video.id));
    load.then((v) => alive && setUpNext(v)).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  // Progress polling + learning: count the seconds you actually watch.
  const videoRef = useRef<Video | undefined>(undefined);
  videoRef.current = video;
  const watched = useRef(0);
  const lastSaved = useRef(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      const p = player.current;
      if (!p?.getCurrentTime) return;
      setTime({ cur: p.getCurrentTime() || 0, dur: p.getDuration() || 0 });
      if (p.getPlayerState?.() === 1) {
        watched.current += 0.5;
        if (videoRef.current && watched.current - lastSaved.current >= 15) {
          lastSaved.current = watched.current;
          recordWatch(videoRef.current, watched.current);
        }
      }
    }, 500);
    return () => window.clearInterval(t);
  }, []);
  // Save what was watched when switching video or leaving the player.
  useEffect(() => {
    watched.current = 0;
    lastSaved.current = 0;
    return () => {
      if (videoRef.current) recordWatch(videoRef.current, watched.current);
    };
  }, [id]);

  // Remote control keys while the video is in front.
  useEffect(() => {
    if (isTouch) return;
    const off = pushKeyHandler((e) => {
      if (modeRef.current !== 'player' || errorRef.current) return false;
      const p = player.current;
      if (!p?.getPlayerState) return false;
      const seek = (d: number) => {
        p.seekTo(Math.max(0, (p.getCurrentTime() || 0) + d), true);
        showOsd();
      };
      switch (e.key) {
        case 'Enter':
        case ' ':
        case 'MediaPlayPause':
          p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo();
          showOsd();
          return true;
        case 'MediaPlay':
          p.playVideo();
          return true;
        case 'MediaPause':
          p.pauseVideo();
          return true;
        case 'ArrowLeft':
          seek(-10);
          return true;
        case 'ArrowRight':
          seek(10);
          return true;
        case 'MediaRewind':
          seek(-30);
          return true;
        case 'MediaFastForward':
          seek(30);
          return true;
        case 'MediaTrackNext':
          goNextRef.current();
          return true;
        case 'ArrowUp':
          showOsd();
          return true;
        case 'ArrowDown':
          setMode('details');
          return true;
      }
      return false;
    });
    const offBack = pushBackHandler(() => {
      if (modeRef.current === 'details') {
        setMode('player');
        showOsd();
        return true;
      }
      return false;
    });
    return () => {
      off();
      offBack();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === 'details') requestAnimationFrame(() => focusFirst());
    else (document.activeElement as HTMLElement | null)?.blur();
  }, [mode]);

  const toggleRate = async (r: 'like' | 'dislike') => {
    const nextR = rating === r ? 'none' : r;
    setRating(nextR);
    if (video) markLiked(video, nextR === 'like');
    if (video && nextR === 'dislike') notInterested(video);
    rate(id, nextR).catch(() => setRating(rating));
  };

  const pct = time.dur ? (time.cur / time.dur) * 100 : 0;

  return (
    <div className={`watch${isTouch ? ' web' : ''}`}>
      {isTouch && (
        <div className="watch-top">
          <button className="btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>
            ← Back
          </button>
        </div>
      )}
      <div className="player" ref={holder} />

      {!isTouch && mode === 'player' && !error && (osd || !playing) && (
        <div className="osd">
          <div className="osd-top">
            <div className="osd-title">{video?.title}</div>
            <div className="card-meta">{video?.channelTitle}</div>
          </div>
          <div className="osd-bottom">
            <div className="osd-state">{playing ? '❚❚' : '▶'}</div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="osd-time">
              {fmtDuration(time.cur) || '0:00'} / {fmtDuration(time.dur)}
            </div>
          </div>
          <div className="osd-hint">OK play/pause • ◀ ▶ 10s • ▼ more</div>
        </div>
      )}

      {error && (isTouch || mode === 'player') && (
        <div className="player-error" data-focus-trap>
          <p>{ERRORS[error] || `Playback error (${error}).`}</p>
          <div className="row">
            <button className="btn primary focusable" data-autofocus onClick={() => openInYouTube(id)}>
              Open in YouTube app
            </button>
            {nextIndex >= 0 && (
              <button className="btn focusable" onClick={goNext}>
                Next video
              </button>
            )}
            <button className="btn focusable" onClick={() => setMode('details')}>
              Details
            </button>
          </div>
        </div>
      )}

      {(isTouch || mode === 'details') && (
        <div className="details" data-focus-trap>
          <div className="details-inner">
            <h1>{video?.title}</h1>
            <div className="card-meta">
              {video && `${fmtCount(video.views)} views • ${timeAgo(video.publishedAt)}`}
            </div>
            <div className="row">
              {!isTouch && (
                <button className="btn focusable" data-autofocus onClick={() => setMode('player')}>
                  ▲ Back to video
                </button>
              )}
              <button className={`btn focusable${rating === 'like' ? ' on' : ''}`} onClick={() => toggleRate('like')}>
                👍 {video ? fmtCount(video.likes) : ''}
              </button>
              <button className={`btn focusable${rating === 'dislike' ? ' on' : ''}`} onClick={() => toggleRate('dislike')}>
                👎
              </button>
              {video && (
                <button className="btn focusable" onClick={() => nav(`/channel/${video.channelId}`)}>
                  {video.channelTitle}
                </button>
              )}
              {video && <SubscribeButton channelId={video.channelId} />}
              <button className="btn focusable" onClick={() => openInYouTube(id)}>
                Open in YouTube
              </button>
              {video && (
                <button
                  className="btn focusable"
                  onClick={() => {
                    notInterested(video);
                    dismissPick({ videoId: video.id });
                    if (!goNext()) nav(-1);
                  }}
                >
                  Not interested
                </button>
              )}
            </div>
            {video?.description && <p className="description">{video.description.slice(0, 700)}</p>}
            {upNext.length > 0 && (
              <>
                <h2 className="section-title">{queue && nextIndex >= 0 ? 'Up next' : `More from ${video?.channelTitle}`}</h2>
                <VideoGrid videos={upNext} title="Up next" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
