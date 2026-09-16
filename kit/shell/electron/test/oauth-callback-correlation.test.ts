import { describe, expect, it } from 'vitest';
import { listenElectronOauthForCode } from '../src/main/oauth.js';
import { findFreePort } from './electron-shell-test-utils.js';

async function callback(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, init); } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe('OAuth listener attempt correlation over real loopback HTTP', () => {
  it('keeps listening after missing/wrong state, incomplete and unrelated callbacks', async () => {
    const port = await findFreePort();
    const uri = `http://127.0.0.1:${port}/oauth/callback`;
    const result = listenElectronOauthForCode({ redirectUri: uri, expectedState: 'pending-state' }, 'oauth_listen_for_code');
    for (const suffix of ['?code=x', '?code=x&state=wrong', '?state=pending-state', '/other?code=x&state=pending-state']) {
      const response = await callback(uri + suffix);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('Authorization received');
    }
    const response = await callback(uri, { method: 'POST', body: 'code=valid&state=pending-state' });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Return to Nimi to finish signing in');
    await expect(result).resolves.toMatchObject({ code: 'valid', state: 'pending-state' });
  });

  it('returns a correlated provider denial without claiming successful login', async () => {
    const port = await findFreePort();
    const uri = `http://127.0.0.1:${port}/oauth/callback`;
    const result = listenElectronOauthForCode({ redirectUri: uri, expectedState: 'pending-state' }, 'oauth_listen_for_code');
    const response = await callback(`${uri}?error=access_denied&state=pending-state`);
    const page = await response.text();
    expect(page).toContain('Authorization failed');
    expect(page).not.toContain('successfully signed in');
    await expect(result).resolves.toMatchObject({ error: 'access_denied', state: 'pending-state' });
  });

  it('rejects callers without the current attempt state before binding', async () => {
    await expect(listenElectronOauthForCode({ redirectUri: 'http://127.0.0.1:1/oauth/callback' }, 'oauth_listen_for_code'))
      .rejects.toMatchObject({ reasonCode: 'electron-shell-required-field-missing' });
  });
});
