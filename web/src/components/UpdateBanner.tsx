import { useEffect } from 'react';
import { APK_PAGE, canSelfUpdate, checkForUpdate, dismissUpdate, installUpdate, useUpdate } from '../update';

let checkedThisLaunch = false;
/** Tests only. */
export function _resetBannerCheck() {
  checkedThisLaunch = false;
}

/** Small card offering a new app version. Checks once each time the app opens. */
export function UpdateBanner() {
  const s = useUpdate();
  useEffect(() => {
    if (checkedThisLaunch) return;
    checkedThisLaunch = true;
    checkForUpdate();
  }, []);

  const busy = s.status === 'downloading' || s.status === 'permission' || s.status === 'confirm';
  if (!s.update || (s.dismissed && !busy)) return null;
  if (s.status === 'none' || s.status === 'checking' || s.status === 'idle') return null;

  const self = canSelfUpdate();
  let text: string;
  if (s.status === 'downloading') text = `Downloading update… ${Math.round(s.progress || 0)}%`;
  else if (s.status === 'permission') text = 'Allow MyTube to install apps, then come back. The update will continue.';
  else if (s.status === 'confirm') text = 'Tap Install to finish the update.';
  else if (s.status === 'error') text = `Update failed: ${s.error}`;
  else if (self) text = `A new version of MyTube is available (1.${s.update.version}).`;
  else text = `A new version of MyTube is available. Install it once from ${APK_PAGE} and later updates will install from here.`;

  return (
    <div className="update-banner" role="status">
      <span className="update-text">{text}</span>
      {!busy && (
        <span className="update-actions">
          {self && (
            <button className="chip focusable active" onClick={installUpdate}>
              {s.status === 'error' ? 'Try again' : 'Update'}
            </button>
          )}
          <button className="chip focusable" onClick={dismissUpdate}>
            Later
          </button>
        </span>
      )}
    </div>
  );
}
