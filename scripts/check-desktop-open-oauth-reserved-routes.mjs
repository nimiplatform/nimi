#!/usr/bin/env node
import {
  failWith,
  pass,
  read,
  requireText,
} from './lib/desktop-open-checks.mjs';

const guardInvariants = new Set([
  'product.oauth-boundary-remains-intact',
  'failure.oauth-opener-custom-scheme',
  'failure.oauth-opener-loopback-v1-open-intent',
]);
const failures = [
  ...requireText('kit/shell/electron/src/main/oauth.ts', [
    'isDesktopOpenReservedOauthUrl',
    'decodeURIComponent',
    '/v1/open-intent',
    '/__nimi_desktop_launch__',
    '/desktop-open',
  ]),
  ...requireText('kit/shell/tauri/src/oauth_commands.rs', [
    'is_desktop_open_reserved_oauth_url',
    'percent_decode_path',
    '/v1/open-intent',
    '/__nimi_desktop_launch__',
    '/desktop-open',
  ]),
];

const electronTest = read('kit/shell/electron/test/electron-shell.test.ts');
const tauriTest = read('kit/shell/tauri/src/oauth_commands.rs');
for (const variant of [
  'http://[::1]:4500/v1/open-intent',
  '/%76%31/%6f%70%65%6e%2d%69%6e%74%65%6e%74',
  '/v1/open-intent/',
  '/v1/open-intent?x=1#fragment',
  '/V1/Open-Intent',
  '/desktop-open/%2e%2e/v1/open-intent',
]) {
  if (!electronTest.includes(variant) || !tauriTest.includes(variant)) {
    failures.push(`OAuth reserved route tests missing ${variant}`);
  }
}
if (guardInvariants.size !== 3) {
  failures.push('desktop open OAuth acceptance assertion registry drifted');
}

failWith('Desktop Open OAuth reserved-route guard failed.', failures);
pass('desktop open OAuth reserved route guard passed');
