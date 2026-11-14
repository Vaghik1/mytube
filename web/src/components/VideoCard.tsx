import { useNavigate } from 'react-router-dom';
import type { Video } from '../api';
import { fmtCount, fmtDuration, fmtStart, timeAgo } from '../util';

export type Queue = { ids: string[]; index: number; title?: string };

export function VideoCard({ v, queue, autoFocus }: { v: Video; queue?: Queue; autoFocus?: boolean }) {
  const nav = useNavigate();
  return (
    <button
      className="card focusable"
      data-autofocus={autoFocus || undefined}
      onClick={() => nav(`/watch/${v.id}`, { state: { queue } })}
    >
      <div className="thumb">
        <img src={v.thumb} alt="" loading="lazy" />
        {v.live ? (
          <span className="badge live">● LIVE</span>
        ) : v.upcoming && v.scheduledStart ? (
          <span className="badge soon">{fmtStart(v.scheduledStart)}</span>
        ) : v.duration ? (
          <span className="badge">{fmtDuration(v.duration)}</span>
        ) : null}
      </div>
      <div className="card-title">{v.title}</div>
      <div className="card-meta">{v.channelTitle}</div>
      <div className="card-meta">
        {v.live
          ? `${v.liveViewers ? `${fmtCount(v.liveViewers)} watching` : 'Live now'}`
          : v.upcoming && v.scheduledStart
            ? `Starts ${fmtStart(v.scheduledStart)}`
            : `${v.views ? `${fmtCount(v.views)} views • ` : ''}${timeAgo(v.publishedAt)}`}
      </div>
    </button>
  );
}
