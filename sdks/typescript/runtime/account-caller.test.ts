import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiDesktopShellRuntimeAccountCaller,
  resolveNimiSDKRuntimeAccountCallerProfile,
} from './index';
import { AccountCallerMode } from '../core-generated/runtime-typed-client';

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
      launchHostId: '',
      launchNonce: '',
      releaseDescriptorRef: '',
    },
  );
});

test('Runtime account caller projection fails closed on missing identity', () => {
  assert.throws(
    () => createNimiDesktopShellRuntimeAccountCaller({ appId: '' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
  );
  assert.throws(
    () => createNimiDesktopShellRuntimeAccountCaller({
      appId: 'nimi.desktop',
      appInstanceId: 'desktop.instance',
      deviceId: '',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
  );
});

test('SDK Runtime account caller profiles map exactly to Runtime caller modes', () => {
  assert.equal(resolveNimiSDKRuntimeAccountCallerProfile('local-app'), null);
  assert.equal(resolveNimiSDKRuntimeAccountCallerProfile('third-party-nimi-app'), null);
  assert.equal(resolveNimiSDKRuntimeAccountCallerProfile('desktop-account-ux'), AccountCallerMode.DESKTOP_SHELL);
  assert.equal(resolveNimiSDKRuntimeAccountCallerProfile('dev-standalone'), null);
});
