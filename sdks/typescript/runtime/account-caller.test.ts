import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiBindingOnlyAvatarRuntimeAccountCaller,
  createNimiDeveloperRegisteredRuntimeAccountCaller,
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  resolveNimiSDKSharedAuthRuntimeCallerMode,
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
    },
  );
});

test('Runtime account caller projection builds an explicit binding-only Avatar identity', () => {
  assert.deepEqual(
    createNimiBindingOnlyAvatarRuntimeAccountCaller({
      appId: 'nimi.avatar',
      appInstanceId: 'nimi.avatar.binding-only',
      deviceId: 'desktop-avatar-host',
    }),
    {
      appId: 'nimi.avatar',
      appInstanceId: 'nimi.avatar.binding-only',
      deviceId: 'desktop-avatar-host',
      mode: AccountCallerMode.DESKTOP_LAUNCHED_AVATAR,
      scopes: [],
    },
  );
});

test('Runtime account caller projection builds explicit developer-registered local identity', () => {
  assert.deepEqual(
    createNimiDeveloperRegisteredRuntimeAccountCaller({
      appId: 'nimi.tester',
      appInstanceId: 'nimi.tester.local-developer',
      deviceId: 'tester-local-developer-device',
      scopes: [' runtime.account ', '', 'runtime.account'],
    }),
    {
      appId: 'nimi.tester',
      appInstanceId: 'nimi.tester.local-developer',
      deviceId: 'tester-local-developer-device',
      mode: AccountCallerMode.LOCAL_DEVELOPER_APP,
      scopes: ['runtime.account'],
    },
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
  assert.throws(
    () => createNimiDeveloperRegisteredRuntimeAccountCaller({
      appId: 'nimi.tester',
      appInstanceId: 'nimi.tester.local-developer',
      deviceId: '',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
  );
});

test('SDK shared-auth app modes map exactly to Runtime caller modes', () => {
  assert.equal(resolveNimiSDKSharedAuthRuntimeCallerMode('first-party-local-app'), AccountCallerMode.LOCAL_FIRST_PARTY_APP);
  assert.equal(resolveNimiSDKSharedAuthRuntimeCallerMode('developer-registered-local-app'), AccountCallerMode.LOCAL_DEVELOPER_APP);
  assert.equal(resolveNimiSDKSharedAuthRuntimeCallerMode('third-party-nimi-app'), null);
  assert.equal(resolveNimiSDKSharedAuthRuntimeCallerMode('desktop-account-ux'), AccountCallerMode.DESKTOP_SHELL);
  assert.equal(resolveNimiSDKSharedAuthRuntimeCallerMode('binding-only-avatar'), AccountCallerMode.DESKTOP_LAUNCHED_AVATAR);
  assert.equal(resolveNimiSDKSharedAuthRuntimeCallerMode('dev-standalone'), null);
});
