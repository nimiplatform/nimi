import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountCallerMode,
  createDesktopShellRuntimeAccountCaller,
  createLocalFirstPartyRuntimeAccountCaller,
} from '../src/runtime/index.js';

test('Runtime account caller helper builds Desktop shell caller shape', () => {
  assert.deepEqual(
    createDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' }),
    {
      appId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
      deviceId: 'desktop-shell',
      mode: AccountCallerMode.DESKTOP_SHELL,
      scopes: [],
    },
  );
});

test('Runtime account caller helper builds local first-party app caller shape', () => {
  assert.deepEqual(
    createLocalFirstPartyRuntimeAccountCaller({ appId: 'app.example', scopes: [' runtime.account ', '', 'runtime.account'] }),
    {
      appId: 'app.example',
      appInstanceId: 'app.example.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: ['runtime.account'],
    },
  );
});

test('Runtime account caller helper fails closed for missing app identity', () => {
  assert.throws(
    () => createDesktopShellRuntimeAccountCaller({ appId: '' }),
    /requires appId/,
  );
  assert.throws(
    () => createLocalFirstPartyRuntimeAccountCaller({ appId: 'app.example', appInstanceId: '' }),
    /requires appInstanceId/,
  );
});
