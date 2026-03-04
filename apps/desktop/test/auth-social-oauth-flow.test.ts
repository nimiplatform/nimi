import assert from 'node:assert/strict';
import test from 'node:test';

import { OAuthProvider } from '@nimiplatform/sdk/realm';
import {
  resolveSocialOauthConfig,
  toOauthProvider,
} from '../src/shell/renderer/features/auth/social-oauth';

test('social oauth maps provider enum correctly', () => {
  assert.equal(toOauthProvider('TWITTER'), OAuthProvider.TWITTER);
  assert.equal(toOauthProvider('TIKTOK'), OAuthProvider.TIKTOK);
});

test('social oauth is disabled with explicit reason when client id is missing', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousClientId = process.env.VITE_NIMI_TWITTER_CLIENT_ID;
  (globalThis as { window: unknown }).window = {
    __TAURI__: { core: { invoke: () => Promise.resolve(null) } },
  };
  delete process.env.VITE_NIMI_TWITTER_CLIENT_ID;
  try {
    const config = resolveSocialOauthConfig('TWITTER');
    assert.equal(config.enabled, false);
    assert.match(config.disabledReason, /Missing TWITTER OAuth client ID/);
  } finally {
    process.env.VITE_NIMI_TWITTER_CLIENT_ID = previousClientId;
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previousWindow;
    }
  }
});

test('social oauth is enabled when tauri invoke and env config are present', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousClientId = process.env.VITE_NIMI_TIKTOK_CLIENT_ID;
  const previousScope = process.env.VITE_NIMI_TIKTOK_SCOPE;
  (globalThis as { window: unknown }).window = {
    __TAURI__: { core: { invoke: () => Promise.resolve(null) } },
  };
  process.env.VITE_NIMI_TIKTOK_CLIENT_ID = 'tiktok-client-id';
  process.env.VITE_NIMI_TIKTOK_SCOPE = 'user.info.basic';
  try {
    const config = resolveSocialOauthConfig('TIKTOK');
    assert.equal(config.enabled, true);
    assert.equal(config.clientId, 'tiktok-client-id');
  } finally {
    process.env.VITE_NIMI_TIKTOK_CLIENT_ID = previousClientId;
    process.env.VITE_NIMI_TIKTOK_SCOPE = previousScope;
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previousWindow;
    }
  }
});
