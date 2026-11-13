import { afterEach, beforeEach } from 'vitest';

// Server and style tests run without a browser environment; only reset browser state when it exists.
const isBrowser = typeof window !== 'undefined';

beforeEach(async () => {
  if (!isBrowser) return;
  localStorage.clear();
  const { resetAgentCache } = await import('../src/agent');
  resetAgentCache();
});

afterEach(() => {
  if (isBrowser) document.body.innerHTML = '';
});
