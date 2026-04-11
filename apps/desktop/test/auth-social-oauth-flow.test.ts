import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { OAuthProvider } from '@nimiplatform/sdk/realm';
import {
  resolveSocialOauthConfig,
  toOauthProvider,
} from '@nimiplatform/nimi-kit/auth';

const authViewMainSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/components/auth-view-main.tsx'),
  'utf8',
);

const desktopOAuthBridge = {
  hasTauriInvoke: () => true,
  oauthListenForCode: async () => ({ callbackUrl: '' }),
  oauthTokenExchange: async () => ({ accessToken: '', raw: {} }),
  openExternalUrl: async () => ({ opened: true }),
  focusMainWindow: async () => undefined,
};

test('social oauth maps provider enum correctly', () => {
  assert.equal(toOauthProvider('TWITTER'), OAuthProvider.TWITTER);
  assert.equal(toOauthProvider('TIKTOK'), OAuthProvider.TIKTOK);
});

test('social oauth is disabled with explicit reason when client id is missing', () => {
  const previousClientId = process.env.VITE_NIMI_TWITTER_CLIENT_ID;
  delete process.env.VITE_NIMI_TWITTER_CLIENT_ID;
  try {
    const config = resolveSocialOauthConfig('TWITTER', desktopOAuthBridge);
    assert.equal(config.enabled, false);
    assert.match(config.disabledReason, /Missing TWITTER OAuth client ID/);
  } finally {
    process.env.VITE_NIMI_TWITTER_CLIENT_ID = previousClientId;
  }
});

test('social oauth is enabled when tauri invoke and env config are present', () => {
  const previousClientId = process.env.VITE_NIMI_TIKTOK_CLIENT_ID;
  const previousScope = process.env.VITE_NIMI_TIKTOK_SCOPE;
  process.env.VITE_NIMI_TIKTOK_CLIENT_ID = 'tiktok-client-id';
  process.env.VITE_NIMI_TIKTOK_SCOPE = 'user.info.basic';
  try {
    const config = resolveSocialOauthConfig('TIKTOK', desktopOAuthBridge);
    assert.equal(config.enabled, true);
    assert.equal(config.clientId, 'tiktok-client-id');
  } finally {
    process.env.VITE_NIMI_TIKTOK_CLIENT_ID = previousClientId;
    process.env.VITE_NIMI_TIKTOK_SCOPE = previousScope;
  }
});

test('embedded alternative panel includes google, twitter, tiktok, and web3 entry points', () => {
  assert.match(authViewMainSource, /label=\{googleDisabledReason \? `Google unavailable:/);
  assert.match(authViewMainSource, /disabled=\{pending \|\| Boolean\(googleDisabledReason\)\}/);
  assert.match(authViewMainSource, /label=\{twitterDisabledReason \? `Twitter unavailable:/);
  assert.match(authViewMainSource, /label=\{tikTokDisabledReason \? `TikTok unavailable:/);
  assert.match(authViewMainSource, /label=\{t\('Auth\.web3'\)\}/);
  assert.match(authViewMainSource, /onWeb3Login/);
});
