// ─────────────────────────────────────────────────────────────
//  Your personal configuration. Edit these defaults freely.
//  Anything changed on the Settings screen is saved on the TV
//  and overrides these values.
// ─────────────────────────────────────────────────────────────

export type Settings = {
  /** Country used only by the Trending tab and category chips (never by "For you"). */
  region: string;
  /** Hide videos of 3 minutes or less (YouTube Shorts) from every feed. */
  hideShorts: boolean;
  /** Channel IDs or exact channel names that should never appear. */
  blockedChannels: string[];
  /** Videos whose title contains any of these words are hidden (case-insensitive). */
  blockedKeywords: string[];
  /** How many of your subscriptions are checked for new uploads (each costs 1 API unit). */
  feedChannelLimit: number;
  /** Play the next video in the list automatically when one ends. */
  autoplayNext: boolean;
  /** Jump over sponsor reads, self-promotion and "like & subscribe" reminders (SponsorBlock). */
  skipSponsors: boolean;
  /** Community-written titles and thumbnails instead of clickbait (DeArrow). */
  betterTitles: boolean;
  /** Phone: when a preview starts, enlarge it to the middle of the screen and dim the rest. */
  zoomPreviews: boolean;
  /** Play a muted preview of the video you stop on while browsing. */
  previewOnBrowse: boolean;
  /**
   * Subtitles in the player. Like YouTube, the choice sticks: it applies to every video until
   * you change it (list previews always show subtitles regardless).
   */
  subtitles: boolean;
  /** Subtitle language last chosen (used when the video has it). */
  subtitleLang: string;
};

export const defaultSettings: Settings = {
  region: 'US',
  hideShorts: false,
  blockedChannels: [],
  blockedKeywords: [],
  feedChannelLimit: 50,
  autoplayNext: true,
  previewOnBrowse: true,
  skipSponsors: true,
  betterTitles: true,
  zoomPreviews: true,
  subtitles: false,
  subtitleLang: 'en',
};

export const REGIONS: [string, string][] = [
  ['AM', 'Armenia'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['RU', 'Russia'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['GE', 'Georgia'],
];

const KEY = 'mytube.settings';

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaultSettings, ...saved };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

// ─────────────────────────────────────────────────────────────
//  Preferences set by ChatGPT (fetched from the assistant hub).
//  They are combined with yours; your own settings above stay as they are.
// ─────────────────────────────────────────────────────────────

export type RemotePrefs = {
  interests: string[];
  favoriteChannels: string[];
  liveTopics: string[];
  dislikedTopics: string[];
  blockedChannels: string[];
  blockedWords: string[];
  hideShorts?: boolean;
  updatedAt?: string;
};

const REMOTE_KEY = 'mytube.remotePrefs';
export const emptyRemotePrefs = (): RemotePrefs => ({
  interests: [],
  favoriteChannels: [],
  liveTopics: [],
  dislikedTopics: [],
  blockedChannels: [],
  blockedWords: [],
});

export function loadRemotePrefs(): RemotePrefs {
  try {
    return { ...emptyRemotePrefs(), ...JSON.parse(localStorage.getItem(REMOTE_KEY) || '{}') };
  } catch {
    return emptyRemotePrefs();
  }
}

export function saveRemotePrefs(p: Partial<RemotePrefs> | undefined) {
  localStorage.setItem(REMOTE_KEY, JSON.stringify({ ...emptyRemotePrefs(), ...(p || {}) }));
}

/** Your settings combined with ChatGPT's: block lists are merged, its Shorts choice wins when set. */
export function effectiveSettings(): Settings & { dislikedTopics: string[] } {
  const s = loadSettings();
  const r = loadRemotePrefs();
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    ...s,
    hideShorts: r.hideShorts ?? s.hideShorts,
    blockedChannels: uniq([...s.blockedChannels, ...r.blockedChannels]),
    blockedKeywords: uniq([...s.blockedKeywords, ...r.blockedWords]),
    dislikedTopics: r.dislikedTopics,
  };
}
