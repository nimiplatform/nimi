import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

describe('frontend taxonomy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('fails closed when one root subcategory request fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/__polyinfo_upstream/polymarket/') {
        return textResponse(`
          <nav aria-label="Main">
            <a href="/new">New</a>
            <a href="/politics">Politics</a>
            <a href="/culture">Culture</a>
          </nav>
        `);
      }
      if (url.includes('tag=politics')) {
        return jsonResponse({
          tags: [
            { id: 'iran', label: 'Iran', slug: 'iran', count: 12 },
          ],
        });
      }
      if (url.includes('tag=culture')) {
        return new Response('', { status: 502 });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchFrontendSectorCatalog } = await import('./frontend-taxonomy.js');
    await expect(fetchFrontendSectorCatalog()).rejects.toThrow('Upstream request failed: 502');

    expect(fetchMock).toHaveBeenCalledWith('/__polyinfo_upstream/polymarket/', undefined);
  });

  it('fails closed when homepage parsing cannot prove root categories', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/__polyinfo_upstream/polymarket/') {
        return textResponse('<nav aria-label="Main"><a href="/new">New</a></nav>');
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchFrontendRootCategories } = await import('./frontend-taxonomy.js');
    await expect(fetchFrontendRootCategories()).rejects.toThrow('Polymarket frontend root taxonomy unavailable.');
  });

  it('fails closed when category event pagination is not exhausted within the bound', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('filteredBySlug')) {
        return jsonResponse({
          tags: [
            { id: 'all', label: 'All', slug: 'politics', count: 5001 },
          ],
        });
      }
      if (url.includes('/events/keyset')) {
        return jsonResponse({
          events: [{ id: `event-${fetchMock.mock.calls.length}`, title: 'Event', slug: 'event' }],
          next_cursor: `cursor-${fetchMock.mock.calls.length}`,
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchFrontendCategoryMapping } = await import('./frontend-taxonomy.js');
    await expect(fetchFrontendCategoryMapping({
      id: 'politics',
      label: 'Politics',
      slug: 'politics',
    })).rejects.toThrow('Frontend taxonomy pagination exhausted before completion for politics');
  });
});
