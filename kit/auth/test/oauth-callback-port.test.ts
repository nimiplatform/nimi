import { describe, expect, it } from 'vitest';

import { createDesktopCallbackRedirectUri } from '../src/logic/oauth-helpers.js';

describe('Desktop OAuth callback allocation', () => {
  it('stays below the OS dynamic-port range used by Windows reservations', () => {
    for (let index = 0; index < 256; index += 1) {
      const callback = new URL(createDesktopCallbackRedirectUri());
      expect(callback.protocol).toBe('http:');
      expect(callback.hostname).toBe('127.0.0.1');
      expect(callback.pathname).toBe('/oauth/callback');
      expect(Number(callback.port)).toBeGreaterThanOrEqual(1_024);
      expect(Number(callback.port)).toBeLessThanOrEqual(49_151);
    }
  });
});
