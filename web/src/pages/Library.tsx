import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getLiked, getMyPlaylists, getPlaylistInfo, getPlaylistVideos, type Playlist as PL } from '../api';
import { PagedGrid, Status } from '../components/VideoGrid';

export function Library() {
  const nav = useNavigate();
  const [lists, setLists] = useState<PL[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    getMyPlaylists()
      .then(setLists)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const tiles: PL[] = [{ id: 'liked', title: 'Liked videos', thumb: '', count: -1 }, ...lists];
  return (
    <div className="page">
      <h2 className="section-title">Library</h2>
      <div className="grid">
        {tiles.map((p) => (
          <button key={p.id} className="card focusable" onClick={() => nav(`/playlist/${p.id}`)}>
            <div className="thumb">
              {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <div className="thumb-placeholder">👍</div>}
              {p.count >= 0 && <span className="badge">{p.count} videos</span>}
            </div>
            <div className="card-title">{p.title}</div>
          </button>
        ))}
      </div>
      <Status loading={loading} error={error} />
    </div>
  );
}

export function Playlist() {
  const { id = '' } = useParams();
  const [title, setTitle] = useState(id === 'liked' ? 'Liked videos' : '');
  useEffect(() => {
    if (id !== 'liked') getPlaylistInfo(id).then((p) => p && setTitle(p.title)).catch(() => {});
  }, [id]);
  return (
    <div className="page">
      <h2 className="section-title">{title}</h2>
      <PagedGrid
        load={(t) => (id === 'liked' ? getLiked(t) : getPlaylistVideos(id, t))}
        deps={[id]}
        title={title}
        empty="This playlist is empty"
      />
    </div>
  );
}
