import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForTvCommands, POLL_MS, sendToTv } from '../src/remote';
import { signIn } from './youtube-mock';

let stop: (() => void) | undefined;
beforeEach(() => signIn());
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

function server(command: unknown) {
  const f = vi.fn(async (_url: string, init?: RequestInit) =>
    new Response(JSON.stringify(init?.method === 'POST' ? { ok: true } : { command }), { status: 200 }),
  );
  vi.stubGlobal('fetch', f);
  return f;
}

describe('Play on TV', () => {
  it('the phone sends the video and where it was', async () => {
    const f = server(null);
    await sendToTv('dQw4w9WgXcQ', 42.9);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/remote');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(String(init!.body))).toEqual({ videoId: 'dQw4w9WgXcQ', start: 42 });
    expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('the TV plays each command once, checking every few seconds', async () => {
    vi.useFakeTimers();
    const f = server({ id: 'c1', videoId: 'dQw4w9WgXcQ', start: 10, at: Date.now() });
    const got: string[] = [];
    stop = listenForTvCommands((c) => got.push(c.videoId));
    await vi.advanceTimersByTimeAsync(10);
    expect(got).toEqual(['dQw4w9WgXcQ']);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(got).toEqual(['dQw4w9WgXcQ']); // same command: not played again
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("doesn't check while the TV app is in the background", async () => {
    vi.useFakeTimers();
    const f = server(null);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    stop = listenForTvCommands(() => {});
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(f).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalled();
  });
});
