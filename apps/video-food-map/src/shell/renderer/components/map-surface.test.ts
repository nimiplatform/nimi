import { describe, expect, it } from 'vitest';
import { buildVenueMarkerLabelHtml } from './map-surface.js';

describe('buildVenueMarkerLabelHtml', () => {
  it('escapes untrusted venue names before building AMap label HTML', () => {
    const html = buildVenueMarkerLabelHtml('<img src=x onerror=alert("x")>&店');

    expect(html).toContain('&lt;img src=x onerror=alert(&quot;x&quot;)&gt;&amp;店');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert("x")');
  });
});
