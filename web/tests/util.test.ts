import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText, fmtCount, fmtDuration, fmtStart, timeAgo } from '../src/util';

describe('fmtDuration', () => {
  it('formats minutes and seconds', () => {
    expect(fmtDuration(5)).toBe('0:05');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(600)).toBe('10:00');
  });
  it('adds hours when needed', () => {
    expect(fmtDuration(3600)).toBe('1:00:00');
    expect(fmtDuration(3725)).toBe('1:02:05');
  });
  it('returns empty for unknown length (live streams)', () => {
    expect(fmtDuration(0)).toBe('');
  });
});

describe('fmtCount', () => {
  it.each([
    [999, '999'],
    [1500, '1.5K'],
    [15_000, '15K'],
    [1_200_000, '1.2M'],
    [25_000_000, '25M'],
    [3_400_000_000, '3.4B'],
  ])('%i → %s', (n, out) => expect(fmtCount(n)).toBe(out));
});

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it('handles empty input', () => expect(timeAgo('')).toBe(''));
  it('says just now under a minute', () => expect(timeAgo(at(10_000))).toBe('just now'));
  it('uses singular and plural', () => {
    expect(timeAgo(at(60_000))).toBe('1 minute ago');
    expect(timeAgo(at(3 * 3600_000))).toBe('3 hours ago');
    expect(timeAgo(at(2 * 86400_000))).toBe('2 days ago');
    expect(timeAgo(at(400 * 86400_000))).toBe('1 year ago');
  });
});

describe('fmtStart (upcoming live streams)', () => {
  afterEach(() => vi.useRealTimers());

  it('shows only the time for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 9, 0));
    expect(fmtStart(new Date(2026, 10, 14, 18, 0).toISOString())).toMatch(/^18[:.]00$/);
  });
  it('says Tomorrow for the next day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 9, 0));
    expect(fmtStart(new Date(2026, 10, 15, 18, 0).toISOString())).toMatch(/^Tomorrow 18[:.]00$/);
  });
  it('includes the date further ahead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 9, 0));
    expect(fmtStart(new Date(2026, 10, 20, 18, 0).toISOString())).toMatch(/20.*18[:.]00/);
  });
});

describe('errorText', () => {
  it('explains the daily quota', () => {
    expect(errorText({ reason: 'quotaExceeded', message: 'x' })).toMatch(/daily limit/);
  });
  it('falls back to the message', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText(undefined)).toBe('Something went wrong');
  });
});
