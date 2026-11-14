// Voice search via the Android app bridge.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  delete (window as any).MyTubeAndroid;
  vi.resetModules();
});

/** Load the app modules with a fake Android app that "hears" `said`. */
async function withBridge(said: string | null, available = true) {
  const started = vi.fn(() => setTimeout(() => (window as any).__mytubeVoice?.(said), 0));
  (window as any).MyTubeAndroid = {
    openInYouTube() {},
    exitApp() {},
    isTv: () => true,
    hasVoiceSearch: () => available,
    startVoiceSearch: started,
  };
  vi.resetModules();
  const { Search } = await import('../src/pages/Search');
  return { Search, started };
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

describe('voice search', () => {
  it('the mic button searches for what you said', async () => {
    const { Search, started } = await withBridge('magnus carlsen blitz');
    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<><Search /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText('Search by voice'));
    expect(started).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/search?q=magnus+carlsen+blitz'));
  });

  it('nothing heard / cancelled: stays as it was', async () => {
    const { Search } = await withBridge(null);
    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<><Search /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => fireEvent.click(screen.getByLabelText('Search by voice')));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('where').textContent).toBe('/search');
  });

  it("the remote's search key opens Search and starts listening", async () => {
    const { Search, started } = await withBridge('chess olympiad');
    render(
      <MemoryRouter initialEntries={['/search?voice=1']}>
        <Routes>
          <Route path="/search" element={<><Search /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/search?q=chess+olympiad'));
  });

  it('no mic button without a speech recognizer (or in a browser)', async () => {
    const { Search } = await withBridge('x', false);
    render(
      <MemoryRouter initialEntries={['/search']}>
        <Search />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Search by voice')).toBeNull();
  });
});
