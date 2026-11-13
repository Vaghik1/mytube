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
};

export const defaultSettings: Settings = {
  region: 'US',
  hideShorts: false,
  blockedChannels: [],
  blockedKeywords: [],
  feedChannelLimit: 50,
  autoplayNext: true,
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
