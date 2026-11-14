// Voice search through the Android app (Google's speech recognition). Works on the TV and the phone app.
import { android } from './tv';

export function canVoiceSearch(): boolean {
  try {
    return typeof android?.startVoiceSearch === 'function' && (android.hasVoiceSearch ? android.hasVoiceSearch() : true);
  } catch {
    return false;
  }
}

/** Listens once. Resolves with what you said, or null if nothing was heard / it was cancelled. */
export function listen(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!canVoiceSearch()) return resolve(null);
    (window as any).__mytubeVoice = (text: string | null) => {
      delete (window as any).__mytubeVoice;
      resolve(text && text.trim() ? text.trim() : null);
    };
    android!.startVoiceSearch!();
  });
}
