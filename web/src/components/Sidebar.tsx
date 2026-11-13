import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getMe, type Channel } from '../api';

const icons: Record<string, string> = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  subs: 'M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 012-2h16a2 2 0 012 2zm-6 4l-6-3.27v6.53L16 16z',
  trending: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z',
  library: 'M4 6H2v14a2 2 0 002 2h14v-2H4V6zm16-4H8a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm-8 12.5v-9l6 4.5-6 4.5z',
  settings: 'M19.14 12.94a7.4 7.4 0 000-1.88l2.03-1.58a.48.48 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7 7 0 00-1.62-.94l-.36-2.54A.48.48 0 0014 2h-3.84a.48.48 0 00-.48.41l-.36 2.54a7.3 7.3 0 00-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.8 8.47a.47.47 0 00.12.61l2.03 1.58a7.3 7.3 0 000 1.88l-2.03 1.58a.48.48 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41H14c.24 0 .44-.17.47-.41l.36-2.54a7 7 0 001.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d={icons[name]} fill="currentColor" />
    </svg>
  );
}

const items = [
  ['/search', 'search', 'Search'],
  ['/', 'home', 'Home'],
  ['/subscriptions', 'subs', 'Subscriptions'],
  ['/trending', 'trending', 'Trending'],
  ['/library', 'library', 'Library'],
  ['/settings', 'settings', 'Settings'],
];

export function Sidebar() {
  const [me, setMe] = useState<Channel>();
  useEffect(() => {
    getMe().then(setMe).catch(() => {});
  }, []);
  return (
    <nav className="sidebar">
      <div className="logo">
        <span className="logo-mark">▶</span>
        <span className="label">MyTube</span>
      </div>
      {items.map(([to, icon, label]) => (
        <NavLink key={to} to={to} end className={({ isActive }) => `nav-item focusable${isActive ? ' active' : ''}`}>
          <Icon name={icon} />
          <span className="label">{label}</span>
        </NavLink>
      ))}
      {me && (
        <div className="me">
          <img src={me.thumb} alt="" />
          <span className="label">{me.title}</span>
        </div>
      )}
    </nav>
  );
}
