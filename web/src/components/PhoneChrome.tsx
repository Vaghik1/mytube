import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Sidebar';

/** How far you must scroll before the top bar hides (px), and the jitter we ignore. */
export const HIDE_AFTER = 56;
const JITTER = 6;

/**
 * Phone top area, like YouTube:
 *  • the status bar strip (clock, battery) is solid at the top of the page and turns
 *    into a translucent tint as content scrolls under it;
 *  • a slim bar with the logo and search hides when you scroll down and returns when you scroll up.
 * Hidden on TV / wide screens by CSS.
 */
export function PhoneChrome() {
  const nav = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = 0;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLElement) || el.tagName !== 'MAIN') return;
      const y = el.scrollTop;
      setScrolled(y > 2);
      if (y < HIDE_AFTER) setHidden(false);
      else if (y > last + JITTER) setHidden(true);
      else if (y < last - JITTER) setHidden(false);
      last = y;
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  return (
    <>
      <div className={`statusbar${scrolled ? ' scrolled' : ''}`} aria-hidden="true" />
      <header className={`topbar${hidden ? ' hidden' : ''}${scrolled ? ' scrolled' : ''}`}>
        <button className="logo topbar-logo" onClick={() => nav('/')} aria-label="Home">
          <span className="logo-mark">▶</span>
          <span>MyTube</span>
        </button>
        <button className="topbar-btn" onClick={() => nav('/search')} aria-label="Search">
          <Icon name="search" />
        </button>
      </header>
    </>
  );
}
