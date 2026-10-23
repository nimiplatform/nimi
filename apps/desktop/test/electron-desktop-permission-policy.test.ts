import assert from 'node:assert/strict';
import test from 'node:test';

import { installDesktopPermissionPolicy } from '../src-electron/desktop-permission-policy.js';

type RequestHandler = (webContents: unknown, permission: string, callback: (granted: boolean) => void, details: Record<string, unknown>) => void;
type CheckHandler = (webContents: unknown, permission: string, origin: string, details: Record<string, unknown>) => boolean;

function policy(denied: ReadonlySet<number> = new Set()) {
  let request: RequestHandler | undefined;
  let check: CheckHandler | undefined;
  installDesktopPermissionPolicy({
    setPermissionRequestHandler: (handler: unknown) => { request = handler as RequestHandler; },
    setPermissionCheckHandler: (handler: unknown) => { check = handler as CheckHandler; },
  } as never, new Set(['nimi-app://desktop', 'nimi-app://avatar']), denied);
  const ask = (url: string, permission: string, details: Record<string, unknown> = {}) => {
    let granted: boolean | undefined;
    request!(null, permission, (value) => { granted = value; }, { requestingUrl: url, ...details });
    return granted;
  };
  return {
    ask,
    check: (origin: string, permission: string, details: Record<string, unknown> = {}) => check!(null, permission, origin, details),
    askForContents: (id: number, permission: string) => {
      let granted: boolean | undefined;
      request!({ id, getURL: () => 'nimi-app://desktop/system-entry.html' }, permission, value => { granted = value; }, { requestingUrl: 'nimi-app://desktop/system-entry.html', mediaTypes: ['audio'] });
      return granted;
    },
    checkForContents: (id: number, permission: string) => check!({ id }, permission, 'nimi-app://desktop', { mediaType: 'audio' }),
  };
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

test('a system overview never inherits same-origin Home browser permissions', () => {
  const denied = new Set<number>();
  const { askForContents, checkForContents } = policy(denied);
  denied.add(42);
  for (const permission of ['media', 'clipboard-sanitized-write', 'notifications']) {
    assert.equal(askForContents(42, permission), false);
    assert.equal(checkForContents(42, permission), false);
  }
  assert.equal(askForContents(43, 'media'), true);
});
