import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getChannel, getChannelVideos, isSubscribed, subscribe, unsubscribe, type Channel as Ch } from '../api';
import { PagedGrid } from '../components/VideoGrid';
import { fmtCount } from '../util';

export function SubscribeButton({ channelId }: { channelId: string }) {
  const [subId, setSubId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSubId(undefined);
    isSubscribed(channelId).then(setSubId).catch(() => setSubId(null));
  }, [channelId]);
  if (subId === undefined) return null;
  return (
    <button
      className={`btn focusable${subId ? '' : ' primary'}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if (subId) {
            await unsubscribe(subId);
            setSubId(null);
          } else setSubId(await subscribe(channelId));
        } catch {
          /* ignore */
        } finally {
          setBusy(false);
        }
      }}
    >
      {subId ? 'Subscribed ✓' : 'Subscribe'}
    </button>
  );
}

export function Channel() {
  const { id = '' } = useParams();
  const [ch, setCh] = useState<Ch>();
  useEffect(() => {
    getChannel(id).then(setCh).catch(() => {});
  }, [id]);
  return (
    <div className="page">
      {ch?.banner && <div className="banner" style={{ backgroundImage: `url(${ch.banner}=w1707)` }} />}
      {ch && (
        <div className="channel-head">
          <img src={ch.thumb} alt="" />
          <div>
            <h1>{ch.title}</h1>
            <div className="card-meta">
              {fmtCount(ch.subscribers || 0)} subscribers • {fmtCount(ch.videoCount || 0)} videos
            </div>
          </div>
          <SubscribeButton channelId={id} />
        </div>
      )}
      <PagedGrid load={(t) => getChannelVideos(id, t)} deps={[id]} title={ch?.title} empty="No videos" />
    </div>
  );
}
