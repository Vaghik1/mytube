import { describe, expect, it, vi } from 'vitest';
import { getAccessToken, isSignedIn, onAuthChange, saveTokens, signOut } from '../src/auth';
import { mockYouTube, signIn } from './youtube-mock';

describe('sign-in tokens', () => {
  it('is signed out with nothing stored', async () => {
    expect(isSignedIn()).toBe(false);
    expect(await getAccessToken()).toBeNull();
  });

  it('returns a valid token without calling the server', async () => {
    signIn();
    const f = mockYouTube({});
    expect(await getAccessToken()).toBe('ya29.test');
    expect(f).not.toHaveBeenCalled();
  });

  it('refreshes an expired token once, even when asked twice at the same time', async () => {
    signIn(-1000);
    const f = mockYouTube({}, { '/api/auth/refresh': () => ({ access_token: 'ya29.new', expires_in: 3600 }) });
    const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);
    expect(a).toBe('ya29.new');
    expect(b).toBe('ya29.new');
    expect(f).toHaveBeenCalledTimes(1);
    // the refresh token is kept for next time
    expect(JSON.parse(localStorage.getItem('mytube.tokens')!).refresh_token).toBe('refresh-1');
  });

  it('signs out when Google revoked access', async () => {
    signIn(-1000);
    mockYouTube({}, { '/api/auth/refresh': () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) });
    expect(await getAccessToken()).toBeNull();
    expect(isSignedIn()).toBe(false);
  });

  it('stays signed in when the refresh fails for another reason (e.g. offline)', async () => {
    signIn(-1000);
    mockYouTube({}, { '/api/auth/refresh': () => new Response('{}', { status: 500 }) });
    expect(await getAccessToken()).toBeNull();
    expect(isSignedIn()).toBe(true);
  });

  it('notifies the app on sign-in and sign-out, and clears cached feeds', () => {
    const spy = vi.fn();
    const off = onAuthChange(spy);
    saveTokens({ access_token: 'ya29.x', refresh_token: 'r', expires_in: 3600 });
    expect(isSignedIn()).toBe(true);
    localStorage.setItem('mytube.cache.subs', '{}');
    signOut();
    expect(isSignedIn()).toBe(false);
    expect(localStorage.getItem('mytube.cache.subs')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    off();
  });
});
