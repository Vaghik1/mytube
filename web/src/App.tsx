import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { isSignedIn, onAuthChange } from './auth';
import { syncProfile } from './agent';
import { startPreviews } from './preview';
import { Sidebar } from './components/Sidebar';
import { PhoneChrome } from './components/PhoneChrome';
import { UpdateBanner } from './components/UpdateBanner';
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
  // Muted previews while browsing lists (not on the player page).
  const onPlayer = pathname.startsWith('/watch/');
  useEffect(() => (signedIn && !onPlayer ? startPreviews() : undefined), [signedIn, onPlayer]);

  // Share the taste profile with the assistant hub now and then.
  useEffect(() => {
    if (!signedIn) return;
    const run = () => syncProfile().catch(() => {});
    run();
    const t = window.setInterval(run, 5 * 60_000);
    return () => window.clearInterval(t);
  }, [signedIn]);

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
        <PhoneChrome />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/library" element={<Library />} />
          <Route path="/playlist/:id" element={<Playlist />} />
          <Route path="/channel/:id" element={<Channel />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <UpdateBanner />
    </div>
  );
}
