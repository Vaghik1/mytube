import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Video } from '../api';
import { fmtCount, fmtDuration, fmtStart, timeAgo } from '../util';
import { usePreviewActive } from '../preview';
import { Preview } from './Preview';
import { startPoint } from '../history';
import { useBranding } from '../community';
import { loadSettings } from '../config';
import { isTouch } from '../tv';

/** Videos whose zoomed preview you closed: they keep playing small until you move on. */
const zoomDismissed = new Set<string>();

/** Where to move/scale a thumbnail so it sits in the middle of the screen, as wide as fits. */
export function zoomTransform(r: { left: number; top: number; width: number; height: number }, vw: number, vh: number) {
  const target = Math.min(vw, ((vh * 0.85) * 16) / 9);
  const scale = target / r.width;
  const dx = vw / 2 - (r.left + r.width / 2);
  const dy = vh / 2 - (r.top + r.height / 2);
  return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${scale.toFixed(3)})`;
}

export type Queue = { ids: string[]; index: number; title?: string };

export function VideoCard({ v, queue, autoFocus }: { v: Video; queue?: Queue; autoFocus?: boolean }) {
  const nav = useNavigate();
  const previewing = usePreviewActive(v.id);
  const resume = v.live ? null : startPoint(v.id);
  const b = useBranding(v);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<CSSProperties | null>(null);

  // Phone: once the preview is really playing, bring it to the middle of the screen.
  const onReveal = () => {
    if (!isTouch || !loadSettings().zoomPreviews || zoomDismissed.has(v.id) || !thumbRef.current) return;
    const r = thumbRef.current.getBoundingClientRect();
    setZoom({ transform: zoomTransform(r, window.innerWidth, window.innerHeight) });
  };
  const closeZoom = () => {
    zoomDismissed.add(v.id);
    setZoom(null);
  };
  useEffect(() => {
    if (!previewing) {
      setZoom(null);
      zoomDismissed.delete(v.id);
    }
  }, [previewing, v.id]);

  return (
    <button
      data-video-id={v.id}
      className={`card focusable${zoom ? ' zoom-host' : ''}`}
      data-autofocus={autoFocus || undefined}
      onClick={() => nav(`/watch/${v.id}`, { state: { queue } })}
    >
      {zoom &&
        createPortal(
          // Tap or swipe anywhere outside the video to close it.
          <div
            className="zoom-backdrop"
            onClick={(e) => {
              e.stopPropagation();
              closeZoom();
            }}
            onTouchMove={closeZoom}
            onWheel={closeZoom}
          />,
          document.body,
        )}
      <div className={`thumb${zoom ? ' zoomed' : ''}`} ref={thumbRef} style={zoom || undefined}>
        <img
          src={b.thumb}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => {
            // DeArrow's thumbnail isn't ready: show YouTube's
            if (e.currentTarget.src !== b.fallbackThumb) e.currentTarget.src = b.fallbackThumb;
          }}
        />
        {previewing && <Preview id={v.id} onReveal={onReveal} />}
        {v.live ? (
          <span className="badge live">● LIVE</span>
        ) : v.upcoming && v.scheduledStart ? (
          <span className="badge soon">{fmtStart(v.scheduledStart)}</span>
        ) : v.duration ? (
          <span className="badge">{fmtDuration(v.duration)}</span>
        ) : null}
        {resume && resume.dur > 0 && (
          // YouTube's red bar: how far you got
          <span className="resume-bar" aria-label="Watched part">
            <span style={{ width: `${Math.min(100, (resume.pos / resume.dur) * 100)}%` }} />
          </span>
        )}
      </div>
      <div className="card-title">{b.title}</div>
      <div className="card-meta">{v.channelTitle}</div>
      <div className="card-meta">
        {v.watchedAt
          ? `Watched ${timeAgo(new Date(v.watchedAt).toISOString())}`
          : v.live
          ? `${v.liveViewers ? `${fmtCount(v.liveViewers)} watching` : 'Live now'}`
          : v.upcoming && v.scheduledStart
            ? `Starts ${fmtStart(v.scheduledStart)}`
            : `${v.views ? `${fmtCount(v.views)} views • ` : ''}${timeAgo(v.publishedAt)}`}
      </div>
    </button>
  );
}
