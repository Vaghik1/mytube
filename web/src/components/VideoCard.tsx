import { useNavigate } from 'react-router-dom';
import type { Video } from '../api';
import { fmtCount, fmtDuration, fmtStart, timeAgo } from '../util';
import { usePreviewActive } from '../preview';
import { Preview } from './Preview';
import { startPoint } from '../history';
import { useBranding } from '../community';

export type Queue = { ids: string[]; index: number; title?: string };

export function VideoCard({ v, queue, autoFocus }: { v: Video; queue?: Queue; autoFocus?: boolean }) {
  const nav = useNavigate();
  const previewing = usePreviewActive(v.id);
  const resume = v.live ? null : startPoint(v.id);
  const b = useBranding(v);
  return (
    <button
      data-video-id={v.id}
      className="card focusable"
      data-autofocus={autoFocus || undefined}
      onClick={() => nav(`/watch/${v.id}`, { state: { queue } })}
    >
      <div className="thumb">
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
        {previewing && <Preview id={v.id} />}
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
