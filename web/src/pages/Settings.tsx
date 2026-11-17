import { useRef, useState } from 'react';
import { clearCache } from '../api';
import { signOut } from '../auth';
import { loadRemotePrefs, defaultSettings, loadSettings, saveSettings, type Settings as S } from '../config';
import { android, isTouch } from '../tv';
import { buildProfile, clearHistory } from '../history';
import { resetAssistantPrefs } from '../agent';
import { clearHistoryEverywhere, syncSoon } from '../historySync';
import { importTakeoutFile } from '../ytImport';
import { canSelfUpdate, checkForUpdate, installUpdate, installedVersion, useUpdate } from '../update';

/** Import what you watched in YouTube itself (Google Takeout), so For you knows your habits there too. */
function YouTubeImport({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setMsg('Reading…');
    try {
      const { found, added } = await importTakeoutFile(file);
      setMsg(
        found === 0
          ? 'No YouTube videos found in this file.'
          : `Imported ${added} videos you watched in YouTube${added < found ? ` (of ${found}: older than 4 months, already known, or over 500 skipped)` : ''}.`,
      );
      clearCache('fy.');
      syncSoon(500); // the TV gets them too
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <h2 className="section-title">Your YouTube watch history</h2>
      <p className="muted">
        YouTube doesn't share your watch history with apps, but you can download it from Google and import it here, so
        "For you" knows which channels you always watch (and skips videos you've already seen).
      </p>
      {isTouch ? (
        <>
          <p className="muted">
            1. Open takeout.google.com → "Deselect all" → select only "YouTube and YouTube Music". 2. "All YouTube data
            included" → only "history". 3. "Multiple formats" → History: JSON. 4. Create the export, download the .zip,
            and choose it here.
          </p>
          <input ref={input} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <div className="chips wrap">
            <button className="chip focusable" disabled={busy} onClick={() => input.current?.click()}>
              Import YouTube history
            </button>
          </div>
        </>
      ) : (
        <p className="muted">Import it on your phone (MyTube → Settings); it shows up here on the TV by itself.</p>
      )}
      {msg && <p className="muted" role="status">{msg}</p>}
    </>
  );
}

function AppUpdates() {
  const u = useUpdate();
  if (installedVersion() === null) return null;
  const line =
    u.status === 'checking' ? 'Checking…'
    : u.status === 'none' ? 'You have the latest version.'
    : u.status === 'available' ? `Version 1.${u.update!.version} is available.`
    : u.status === 'downloading' ? `Downloading… ${Math.round(u.progress || 0)}%`
    : u.status === 'permission' ? 'Allow MyTube to install apps, then come back.'
    : u.status === 'confirm' ? 'Confirm the install on screen.'
    : u.status === 'error' ? `Couldn't update: ${u.error}`
    : '';
  return (
    <>
      <h2 className="section-title">App updates</h2>
      {line && <p className="muted update-line">{line}</p>}
      <div className="chips wrap">
        {u.status === 'available' && canSelfUpdate() ? (
          <button className="chip focusable active" onClick={installUpdate}>
            Update now
          </button>
        ) : (
          <button className="chip focusable" onClick={() => checkForUpdate()}>
            Check for updates
          </button>
        )}
      </div>
    </>
  );
}

export function Settings() {
  const [s, setS] = useState<S>(loadSettings);
  const [profile, setProfile] = useState(buildProfile);
  const [remote, setRemote] = useState(loadRemotePrefs);
  const update = (patch: Partial<S>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    clearCache();
  };

  return (
    <div className="page settings">
      <h2 className="section-title">Feed</h2>
      <div className="chips wrap">
        <button className={`chip focusable${s.hideShorts ? ' active' : ''}`} onClick={() => update({ hideShorts: !s.hideShorts })}>
          Hide Shorts: {s.hideShorts ? 'On' : 'Off'}
        </button>
        <button className={`chip focusable${s.autoplayNext ? ' active' : ''}`} onClick={() => update({ autoplayNext: !s.autoplayNext })}>
          Autoplay next: {s.autoplayNext ? 'On' : 'Off'}
        </button>
        {isTouch && (
          <button className={`chip focusable${s.previewOnBrowse ? ' active' : ''}`} onClick={() => update({ previewOnBrowse: !s.previewOnBrowse })}>
            Previews while browsing: {s.previewOnBrowse ? 'On' : 'Off'}
          </button>
        )}
        {isTouch && (
          <button className={`chip focusable${s.zoomPreviews ? ' active' : ''}`} onClick={() => update({ zoomPreviews: !s.zoomPreviews })}>
            Enlarge previews: {s.zoomPreviews ? 'On' : 'Off'}
          </button>
        )}
        <button className={`chip focusable${s.subtitles ? ' active' : ''}`} onClick={() => update({ subtitles: !s.subtitles })}>
          Subtitles: {s.subtitles ? 'On' : 'Off'}
        </button>
        <button className={`chip focusable${s.skipSponsors ? ' active' : ''}`} onClick={() => update({ skipSponsors: !s.skipSponsors })}>
          Skip sponsors: {s.skipSponsors ? 'On' : 'Off'}
        </button>
        <button className={`chip focusable${s.betterTitles ? ' active' : ''}`} onClick={() => update({ betterTitles: !s.betterTitles })}>
          Better titles: {s.betterTitles ? 'On' : 'Off'}
        </button>
      </div>
      <p className="muted">
        Sponsor skipping uses SponsorBlock; better titles and thumbnails use DeArrow. Both are community projects
        (sponsor.ajay.app), data under CC BY-NC-SA 4.0.
      </p>

      {(s.blockedChannels.length > 0 || s.blockedKeywords.length > 0) && (
        <>
          <h2 className="section-title">Blocked (edit in config.ts)</h2>
          <p className="muted">
            Channels: {s.blockedChannels.join(', ') || '—'} · Words: {s.blockedKeywords.join(', ') || '—'}
          </p>
        </>
      )}

      <h2 className="section-title">What MyTube has learned ({profile.watches} videos watched)</h2>
      {profile.watches < 3 ? (
        <p className="muted">Watch a few videos and "For you" will start adapting to you.</p>
      ) : (
        <>
          <p className="muted">Top channels: {profile.channels.slice(0, 6).map((c) => c.title).join(', ') || '—'}</p>
          <p className="muted">Top topics: {profile.terms.slice(0, 10).map((t) => t.term).join(', ') || '—'}</p>
        </>
      )}
      <div className="chips wrap">
        <button
          className="chip focusable"
          onClick={() => {
            clearHistory();
            clearHistoryEverywhere().catch(() => {});
            clearCache('fy.');
            setProfile(buildProfile());
          }}
        >
          Clear watch history (TV and phone)
        </button>
      </div>

      <YouTubeImport onDone={() => setProfile(buildProfile())} />

      <h2 className="section-title">Set by ChatGPT</h2>
      {[
        ['Interests', remote.interests],
        ['Favourite channels', remote.favoriteChannels],
        ['Live topics', remote.liveTopics],
        ['Hidden topics', remote.dislikedTopics],
        ['Blocked channels', remote.blockedChannels],
        ['Blocked words', remote.blockedWords],
      ]
        .filter(([, list]) => (list as string[]).length)
        .map(([label, list]) => (
          <p key={label as string} className="muted">
            {label}: {(list as string[]).join(', ')}
          </p>
        ))}
      {remote.hideShorts !== undefined && <p className="muted">Shorts: {remote.hideShorts ? 'hidden' : 'shown'} (ChatGPT's choice)</p>}
      {Object.values(remote).every((v) => !Array.isArray(v) || !v.length) && remote.hideShorts === undefined ? (
        <p className="muted">Nothing yet. Ask ChatGPT, e.g. "add chess and physics to my MyTube interests".</p>
      ) : (
        <div className="chips wrap">
          <button
            className="chip focusable"
            onClick={() => {
              resetAssistantPrefs()
                .then(setRemote)
                .catch(() => {});
              clearCache('fy.');
            }}
          >
            Reset ChatGPT preferences
          </button>
        </div>
      )}

      <AppUpdates />

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
