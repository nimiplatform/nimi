import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiDeveloperRegisteredRuntimeAccountCaller,
  createNimiDesktopLaunchedNimiAppRuntimeAccountCaller,
  createNimiDesktopShellRuntimeAccountCaller,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE,
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

test('Runtime account caller projection supports Desktop-launched installed Nimi App posture', () => {
  assert.deepEqual(
    createNimiDesktopLaunchedNimiAppRuntimeAccountCaller({
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      bindingSource: NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE,
      launchHostId: 'desktop-electron-installed-app-host',
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
      scopes: [' runtime.account ', '', 'runtime.account'],
    }),
    {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      mode: AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP,
      launchHostId: 'desktop-electron-installed-app-host',
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
      scopes: ['runtime.account'],
    },
  );
});

test('Runtime account caller projection rejects installed Nimi App posture without launch binding evidence', () => {
  assert.throws(
    () => createNimiDesktopLaunchedNimiAppRuntimeAccountCaller({
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: 'desktop-electron-installed-app-host',
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_INSTALLED_APP_CALLER_BINDING_REQUIRED',
  );
  assert.throws(
    () => createNimiDesktopLaunchedNimiAppRuntimeAccountCaller({
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      bindingSource: NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE,
      launchHostId: 'desktop-electron-installed-app-host',
      launchNonce: '',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_INSTALLED_APP_CALLER_BINDING_REQUIRED',
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
