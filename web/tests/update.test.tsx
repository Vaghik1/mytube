import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner, _resetBannerCheck } from '../src/components/UpdateBanner';
import { Settings } from '../src/pages/Settings';
import { RELEASES_URL, _resetUpdate, checkForUpdate, getUpdateState, installedVersion } from '../src/update';

const APK = 'https://github.com/Vaghik1/mytube/releases/download/build-30/mytube.apk';

function release(build: number, assets = [{ name: 'mytube.apk', browser_download_url: APK }]) {
  return { tag_name: `build-${build}`, assets };
}

function mockReleases(body: unknown, ok = true) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url !== RELEASES_URL) throw new Error('unexpected ' + url);
    return { ok, status: ok ? 200 : 403, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bridge(version: string, selfUpdate = true) {
  return {
    openInYouTube: vi.fn(),
    exitApp: vi.fn(),
    appVersion: () => version,
    isTv: () => false,
    ...(selfUpdate ? { installUpdate: vi.fn() } : {}),
  };
}

/** What the Android app calls while it downloads and installs. */
const native = (status: string, value?: string) => act(() => (window as any).__mytubeUpdate(status, value));

beforeEach(() => {
  _resetBannerCheck();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  _resetUpdate(undefined);
});

describe('checking for a new app version', () => {
  it('reads the installed build number from the app version', () => {
    _resetUpdate(bridge('1.27'));
    expect(installedVersion()).toBe(27);
    _resetUpdate(bridge('weird'));
    expect(installedVersion()).toBeNull();
  });

  it('offers the newer APK from the latest GitHub release', async () => {
    _resetUpdate(bridge('1.27'));
    mockReleases(release(30));
    const s = await checkForUpdate();
    expect(s.status).toBe('available');
    expect(s.update).toEqual({ version: 30, url: APK });
  });

  it('says up to date when the installed app is the latest', async () => {
    _resetUpdate(bridge('1.30'));
    mockReleases(release(30));
    expect((await checkForUpdate()).status).toBe('none');
  });

  it('does nothing on the website in a browser (no app)', async () => {
    _resetUpdate(undefined);
    const f = mockReleases(release(30));
    expect((await checkForUpdate()).status).toBe('idle');
    expect(f).not.toHaveBeenCalled();
  });

  it('reports GitHub errors and releases without an APK', async () => {
    _resetUpdate(bridge('1.27'));
    mockReleases({}, false);
    expect((await checkForUpdate()).status).toBe('error');
    mockReleases(release(30, []));
    const s = await checkForUpdate();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/No APK/);
  });
});

describe('update banner', () => {
  it('checks once when the app opens and offers the update', async () => {
    const b = bridge('1.27');
    _resetUpdate(b);
    const f = mockReleases(release(30));
    const { unmount } = render(<UpdateBanner />);
    expect(await screen.findByText(/new version of MyTube is available \(1\.30\)/)).toBeTruthy();
    unmount();
    render(<UpdateBanner />);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when up to date', async () => {
    _resetUpdate(bridge('1.30'));
    mockReleases(release(30));
    const { container } = render(<UpdateBanner />);
    await waitFor(() => expect(getUpdateState().status).toBe('none'));
    expect(container.innerHTML).toBe('');
  });

  it('Update hands the APK address to the app and follows its progress to the install screen', async () => {
    const b = bridge('1.27');
    _resetUpdate(b);
    mockReleases(release(30));
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByText('Update'));
    expect(b.installUpdate).toHaveBeenCalledWith(APK);
    expect(screen.getByText(/Downloading update… 0%/)).toBeTruthy();
    native('downloading', '42');
    expect(screen.getByText(/Downloading update… 42%/)).toBeTruthy();
    expect(screen.queryByText('Later')).toBeNull(); // no buttons while busy
    native('confirm');
    expect(screen.getByText(/Tap Install/)).toBeTruthy();
  });

  it('asks for the install permission first when Android needs it', async () => {
    _resetUpdate(bridge('1.27'));
    mockReleases(release(30));
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByText('Update'));
    native('permission');
    expect(screen.getByText(/Allow MyTube to install apps/)).toBeTruthy();
  });

  it('offers to try again after a failure, and goes back to the offer if the install is cancelled', async () => {
    _resetUpdate(bridge('1.27'));
    mockReleases(release(30));
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByText('Update'));
    native('error', 'Download failed (404)');
    expect(screen.getByText(/Update failed: Download failed \(404\)/)).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    native('cancelled');
    expect(screen.getByText('Update')).toBeTruthy();
  });

  it('Later hides it until the next time the app opens', async () => {
    _resetUpdate(bridge('1.27'));
    mockReleases(release(30));
    const { container } = render(<UpdateBanner />);
    fireEvent.click(await screen.findByText('Later'));
    expect(container.innerHTML).toBe('');
  });

  it('older apps that cannot update themselves are told where to reinstall once', async () => {
    _resetUpdate(bridge('1.27', false));
    mockReleases(release(30));
    render(<UpdateBanner />);
    expect(await screen.findByText(/Install it once from .*\/apk/)).toBeTruthy();
    expect(screen.queryByText('Update')).toBeNull();
  });
});

describe('Settings → App updates', () => {
  const renderSettings = () =>
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

  it('is hidden on the website', () => {
    _resetUpdate(undefined);
    renderSettings();
    expect(screen.queryByText('App updates')).toBeNull();
  });

  it('checks on demand and offers Update now', async () => {
    const b = bridge('1.27');
    _resetUpdate(b);
    mockReleases(release(30));
    renderSettings();
    fireEvent.click(screen.getByText('Check for updates'));
    expect(await screen.findByText('Version 1.30 is available.')).toBeTruthy();
    fireEvent.click(screen.getByText('Update now'));
    expect(b.installUpdate).toHaveBeenCalledWith(APK);
  });

  it('says when you already have the latest version', async () => {
    _resetUpdate(bridge('1.30'));
    mockReleases(release(30));
    renderSettings();
    fireEvent.click(screen.getByText('Check for updates'));
    expect(await screen.findByText('You have the latest version.')).toBeTruthy();
  });
});
