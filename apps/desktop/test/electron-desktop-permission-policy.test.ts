import assert from 'node:assert/strict';
import test from 'node:test';

import { installDesktopPermissionPolicy } from '../src-electron/desktop-permission-policy.js';

type RequestHandler = (webContents: unknown, permission: string, callback: (granted: boolean) => void, details: Record<string, unknown>) => void;
type CheckHandler = (webContents: unknown, permission: string, origin: string, details: Record<string, unknown>) => boolean;

function policy() {
  let request: RequestHandler | undefined;
  let check: CheckHandler | undefined;
  installDesktopPermissionPolicy({
    setPermissionRequestHandler: (handler: unknown) => { request = handler as RequestHandler; },
    setPermissionCheckHandler: (handler: unknown) => { check = handler as CheckHandler; },
  } as never, new Set(['nimi-app://desktop', 'nimi-app://avatar']));
  const ask = (url: string, permission: string, details: Record<string, unknown> = {}) => {
    let granted: boolean | undefined;
    request!(null, permission, (value) => { granted = value; }, { requestingUrl: url, ...details });
    return granted;
  };
  return { ask, check: (origin: string, permission: string, details: Record<string, unknown> = {}) => check!(null, permission, origin, details) };
}

test('Home and Avatar get the microphone and clipboard writes, nothing else', () => {
  const { ask, check } = policy();
  assert.equal(ask('nimi-app://desktop/index.html', 'media', { mediaTypes: ['audio'] }), true);
  assert.equal(ask('nimi-app://avatar/index.html', 'media', { mediaTypes: ['audio'] }), true);
  assert.equal(ask('nimi-app://desktop/index.html', 'clipboard-sanitized-write'), true);
  for (const [permission, details] of [
    ['media', { mediaTypes: ['video'] }],
    ['media', { mediaTypes: ['audio', 'video'] }],
    ['media', { mediaTypes: [] }],
    ['clipboard-read', {}],
    ['notifications', {}],
    ['geolocation', {}],
    ['display-capture', {}],
    ['openExternal', {}],
  ] as const) {
    assert.equal(ask('nimi-app://desktop/index.html', permission, details), false, `${permission} ${JSON.stringify(details)}`);
  }
  assert.equal(check('nimi-app://desktop', 'media', { mediaType: 'audio' }), true);
  assert.equal(check('nimi-app://desktop', 'media', { mediaType: 'video' }), false);
  assert.equal(check('nimi-app://desktop', 'clipboard-sanitized-write'), true);
  assert.equal(check('nimi-app://desktop', 'notifications'), false);
});

test('a page that is not Nimi\'s own gets nothing', () => {
  const { ask, check } = policy();
  assert.equal(ask('https://example.com/', 'media', { mediaTypes: ['audio'] }), false);
  assert.equal(ask('nimi-app://other/index.html', 'clipboard-sanitized-write'), false);
  assert.equal(ask('', 'media', { mediaTypes: ['audio'] }), false);
  assert.equal(check('https://example.com', 'media', { mediaType: 'audio' }), false);
});
