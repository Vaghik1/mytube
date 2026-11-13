import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { isSignedIn, onAuthChange } from './auth';
import { Sidebar } from './components/Sidebar';
import { Channel } from './pages/Channel';
import { Home } from './pages/Home';
import { Library, Playlist } from './pages/Library';
import { Login } from './pages/Login';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { Subscriptions } from './pages/Subscriptions';
import { Watch } from './pages/Watch';

export function App() {
  const [signedIn, setSignedIn] = useState(isSignedIn);
  const { pathname } = useLocation();
  useEffect(() => onAuthChange(() => setSignedIn(isSignedIn())), []);

  if (!signedIn) return <Login />;

  if (pathname.startsWith('/watch/'))
    return (
      <Routes>
        <Route path="/watch/:id" element={<Watch />} />
      </Routes>
    );

  return (
    <div className="layout">
      <Sidebar />
      <main key={pathname + location.search}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/trending" element={<Home initial="trending" />} />
          <Route path="/search" element={<Search />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/library" element={<Library />} />
          <Route path="/playlist/:id" element={<Playlist />} />
          <Route path="/channel/:id" element={<Channel />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}
