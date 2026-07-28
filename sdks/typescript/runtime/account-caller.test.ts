import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiAvatarNativeHostRuntimeAccountCaller,
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  resolveNimiSDKRuntimeAccountCallerMode,
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

test('Runtime account caller projection builds explicit local first-party identity for Runtime registration', () => {
  assert.deepEqual(
    createNimiLocalFirstPartyRuntimeAccountCaller({
      appId: 'app.example',
      appInstanceId: 'app.example.local-dev',
      deviceId: 'developer-machine',
      scopes: [' runtime.account ', '', 'runtime.account'],
    }),
    {
      appId: 'app.example',
      appInstanceId: 'app.example.local-dev',
      deviceId: 'developer-machine',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: ['runtime.account'],
      launchHostId: '',
      launchNonce: '',
      releaseDescriptorRef: '',
    },
  );
});

test('Runtime account caller projection fixes the independent bundled Avatar identity', () => {
  assert.deepEqual(createNimiAvatarNativeHostRuntimeAccountCaller(), {
    appId: 'nimi.avatar',
    appInstanceId: 'nimi.avatar',
    deviceId: 'avatar-native-host',
    mode: AccountCallerMode.AVATAR_NATIVE_HOST,
    scopes: [],
    launchHostId: '',
    launchNonce: '',
    releaseDescriptorRef: '',
  });
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
      launchHostId: '',
      launchNonce: '',
      releaseDescriptorRef: '',
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
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_REGISTRATION_REQUIRED',
  );
  assert.throws(
    () => createNimiLocalFirstPartyRuntimeAccountCaller({
      appId: 'app.example',
      appInstanceId: 'app.example.local-dev',
      deviceId: '',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
  );
});

test('SDK Runtime account app modes map exactly to Runtime caller modes', () => {
  assert.equal(resolveNimiSDKRuntimeAccountCallerMode('first-party-local-app'), AccountCallerMode.LOCAL_FIRST_PARTY_APP);
  assert.equal(resolveNimiSDKRuntimeAccountCallerMode('local-app'), null);
  assert.equal(resolveNimiSDKRuntimeAccountCallerMode('third-party-nimi-app'), null);
  assert.equal(resolveNimiSDKRuntimeAccountCallerMode('desktop-account-ux'), AccountCallerMode.DESKTOP_SHELL);
  assert.equal(resolveNimiSDKRuntimeAccountCallerMode('avatar-native-host'), AccountCallerMode.AVATAR_NATIVE_HOST);
  assert.equal(resolveNimiSDKRuntimeAccountCallerMode('dev-standalone'), null);
});
