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

  it('keeps usable sectors when one root subcategory request fails', async () => {
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
    const sectors = await fetchFrontendSectorCatalog();

    expect(sectors.map((sector) => sector.slug)).toEqual(['politics', 'culture', 'iran']);
    expect(fetchMock).toHaveBeenCalledWith('/__polyinfo_upstream/polymarket/', undefined);
  });
});
