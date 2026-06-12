import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiLocalFirstPartyRuntimeAccountCaller,
} from './index';
import { AccountCallerMode } from '../core-generated/runtime-typed-client';

test('Runtime account caller projection rejects shape-only local first-party identity', () => {
  assert.throws(
    () => createNimiLocalFirstPartyRuntimeAccountCaller({
      appId: 'app.example',
      scopes: [' runtime.account ', '', 'runtime.account'],
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_REGISTRATION_REQUIRED',
  );
});

test('Runtime account caller projection supports desktop shell caller identity', () => {
  assert.deepEqual(
    createNimiDesktopShellRuntimeAccountCaller({
      appId: 'nimi.desktop',
      appInstanceId: 'desktop.instance',
      deviceId: 'desktop.device',
    }),
    {
      appId: 'nimi.desktop',
      appInstanceId: 'desktop.instance',
      deviceId: 'desktop.device',
      mode: AccountCallerMode.DESKTOP_SHELL,
      scopes: [],
    },
  );
});

test('Runtime account caller projection fails closed on missing identity', () => {
  assert.throws(
    () => createNimiLocalFirstPartyRuntimeAccountCaller({ appId: '' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
  );
  assert.throws(
    () => createNimiLocalFirstPartyRuntimeAccountCaller({ appId: 'app.example', appInstanceId: '' }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_REGISTRATION_REQUIRED',
  );
});
