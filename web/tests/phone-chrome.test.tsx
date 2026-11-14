import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { HIDE_AFTER, PhoneChrome } from '../src/components/PhoneChrome';

afterEach(() => cleanup());

function setup() {
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <PhoneChrome />
            </main>
          }
        />
        <Route path="/search" element={<div>Search page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  const main = document.querySelector('main') as HTMLElement;
  const scrollTo = (y: number) =>
    act(() => {
      main.scrollTop = y;
      main.dispatchEvent(new Event('scroll'));
    });
  const statusbar = () => document.querySelector('.statusbar')!.className;
  const topbar = () => document.querySelector('.topbar')!.className;
  return { view, main, scrollTo, statusbar, topbar };
}

describe('phone top area', () => {
  it('is solid at the top of the page', () => {
    const { statusbar, topbar } = setup();
    expect(statusbar()).not.toContain('scrolled');
    expect(topbar()).not.toContain('hidden');
  });

  it('turns translucent as soon as content scrolls under it, and solid again at the top', () => {
    const { scrollTo, statusbar } = setup();
    scrollTo(20);
    expect(statusbar()).toContain('scrolled');
    scrollTo(0);
    expect(statusbar()).not.toContain('scrolled');
  });

  it('hides the top bar when scrolling down and shows it when scrolling up', () => {
    const { scrollTo, topbar } = setup();
    scrollTo(HIDE_AFTER + 10);
    scrollTo(HIDE_AFTER + 200);
    expect(topbar()).toContain('hidden');
    scrollTo(HIDE_AFTER + 120);
    expect(topbar()).not.toContain('hidden');
  });

  it('keeps the top bar near the top of the page and ignores tiny jitter', () => {
    const { scrollTo, topbar } = setup();
    scrollTo(HIDE_AFTER - 10);
    expect(topbar()).not.toContain('hidden');
    scrollTo(HIDE_AFTER + 300);
    scrollTo(HIDE_AFTER + 303); // finger jitter
    expect(topbar()).toContain('hidden');
  });

  it('ignores scrolling inside other things (e.g. a sideways row)', () => {
    const { topbar, statusbar } = setup();
    const row = document.createElement('div');
    document.querySelector('main')!.appendChild(row);
    act(() => {
      row.scrollTop = 500;
      row.dispatchEvent(new Event('scroll'));
    });
    expect(statusbar()).not.toContain('scrolled');
    expect(topbar()).not.toContain('hidden');
  });

  it('search button opens Search', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Search'));
    expect(screen.getByText('Search page')).toBeTruthy();
  });
});
