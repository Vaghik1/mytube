import { useState } from 'react';
import { clearCache } from '../api';
import { signOut } from '../auth';
import { REGIONS, defaultSettings, loadSettings, saveSettings, type Settings as S } from '../config';
import { android } from '../tv';

export function Settings() {
  const [s, setS] = useState<S>(loadSettings);
  const update = (patch: Partial<S>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    clearCache();
  };

  return (
    <div className="page settings">
      <h2 className="section-title">Region (Trending & categories)</h2>
      <div className="chips wrap">
        {REGIONS.map(([code, name]) => (
          <button
            key={code}
            className={`chip focusable${s.region === code ? ' active' : ''}`}
            data-autofocus={s.region === code || undefined}
            onClick={() => update({ region: code })}
          >
            {name}
          </button>
        ))}
      </div>

      <h2 className="section-title">Feed</h2>
      <div className="chips wrap">
        <button className={`chip focusable${s.hideShorts ? ' active' : ''}`} onClick={() => update({ hideShorts: !s.hideShorts })}>
          Hide Shorts: {s.hideShorts ? 'On' : 'Off'}
        </button>
        <button className={`chip focusable${s.autoplayNext ? ' active' : ''}`} onClick={() => update({ autoplayNext: !s.autoplayNext })}>
          Autoplay next: {s.autoplayNext ? 'On' : 'Off'}
        </button>
        <button className="chip focusable" onClick={() => update({ subsPerTrending: (s.subsPerTrending % 4) + 1 })}>
          For you mix: {s.subsPerTrending} subscription : 1 trending
        </button>
      </div>

      {(s.blockedChannels.length > 0 || s.blockedKeywords.length > 0) && (
        <>
          <h2 className="section-title">Blocked (edit in config.ts)</h2>
          <p className="muted">
            Channels: {s.blockedChannels.join(', ') || '—'} · Words: {s.blockedKeywords.join(', ') || '—'}
          </p>
        </>
      )}

      <h2 className="section-title">Account</h2>
      <div className="chips wrap">
        <button className="chip focusable" onClick={() => clearCache()}>
          Refresh feeds
        </button>
        <button className="chip focusable" onClick={() => update({ ...defaultSettings })}>
          Reset settings
        </button>
        <button className="chip focusable" onClick={signOut}>
          Sign out
        </button>
        {android && (
          <button className="chip focusable" onClick={() => android!.exitApp()}>
            Exit app
          </button>
        )}
      </div>
      <p className="muted">App version {android?.appVersion?.() || 'web'} · web build {__BUILD__}</p>
    </div>
  );
}
