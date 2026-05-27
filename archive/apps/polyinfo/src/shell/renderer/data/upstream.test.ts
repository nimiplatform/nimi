import { describe, expect, it } from 'vitest';
import { resolvePolyinfoUpstreamUrl } from './upstream.js';

describe('polyinfo upstream URL resolution', () => {
  it('uses same-origin dev proxy routes for Polymarket upstreams', () => {
    expect(resolvePolyinfoUpstreamUrl('https://polymarket.com', '/')).toBe(
      '/__polyinfo_upstream/polymarket/',
    );
    expect(resolvePolyinfoUpstreamUrl('https://gamma-api.polymarket.com', '/events/keyset?limit=1')).toBe(
      '/__polyinfo_upstream/gamma/events/keyset?limit=1',
    );
    expect(resolvePolyinfoUpstreamUrl('https://clob.polymarket.com', '/batch-prices-history')).toBe(
      '/__polyinfo_upstream/clob/batch-prices-history',
    );
  });
});
