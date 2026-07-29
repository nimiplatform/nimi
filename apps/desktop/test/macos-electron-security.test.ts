import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertMacOSElectronSecurity,
  resolveElectronRuntimeDeploymentProfile,
} from '../src-electron/macos-electron-security.js';

function commandLine(switches: Readonly<Record<string, string>>): {
  getSwitchValue(name: string): string;
  hasSwitch(name: string): boolean;
} {
  return {
    getSwitchValue: (name) => switches[name] ?? '',
    hasSwitch: (name) => Object.hasOwn(switches, name),
  };
}

test('macOS Electron rejects Chromium switches that weaken process or origin security', () => {
  for (const forbidden of ['no-sandbox', 'disable-web-security', 'remote-debugging-pipe']) {
    assert.throws(
      () => assertMacOSElectronSecurity({
        platform: 'darwin',
        commandLine: commandLine({ [forbidden]: '' }),
      }),
      (error) => error instanceof Error
        && 'reasonCode' in error
        && error.reasonCode === 'macos-electron-unsafe-chromium-switch',
    );
  }
});

test('macOS Electron rejects CDP switches outside the explicit local-development build', () => {
  assert.throws(
    () => assertMacOSElectronSecurity({
      platform: 'darwin',
      commandLine: commandLine({
        'remote-debugging-address': '127.0.0.1',
        'remote-debugging-port': '19470',
      }),
      localDevelopmentBuild: false,
    }),
    (error) => error instanceof Error
      && 'reasonCode' in error
      && error.reasonCode === 'macos-electron-unsafe-chromium-switch',
  );
});

test('macOS Electron admits only the exact loopback CDP shape for an explicit local-development build', () => {
  assert.doesNotThrow(() => assertMacOSElectronSecurity({
    platform: 'darwin',
    commandLine: commandLine({
      'remote-debugging-address': '127.0.0.1',
      'remote-debugging-port': '19470',
    }),
    localDevelopmentBuild: true,
  }));

  const rejectedSwitches: ReadonlyArray<Readonly<Record<string, string>>> = [
    { 'remote-debugging-port': '19470' },
    { 'remote-debugging-address': '127.0.0.1' },
    { 'remote-debugging-address': 'localhost', 'remote-debugging-port': '19470' },
    { 'remote-debugging-address': '127.0.0.1', 'remote-debugging-port': '80' },
    { 'remote-debugging-address': '127.0.0.1', 'remote-debugging-port': '019470' },
  ];
  for (const switches of rejectedSwitches) {
    assert.throws(() => assertMacOSElectronSecurity({
      platform: 'darwin',
      commandLine: commandLine(switches),
      localDevelopmentBuild: true,
    }), (error) => error instanceof Error
      && 'reasonCode' in error
      && error.reasonCode === 'macos-electron-unsafe-chromium-switch');
  }
});

test('ordinary macOS workspace Electron development admits only loopback CDP', () => {
  assert.doesNotThrow(() => assertMacOSElectronSecurity({
    platform: 'darwin',
    commandLine: commandLine({
      'remote-debugging-address': '127.0.0.1',
      'remote-debugging-port': '19470',
    }),
    electronDevelopmentBuild: true,
    localDevelopmentBuild: false,
  }));
  assert.throws(() => assertMacOSElectronSecurity({
    platform: 'darwin',
    commandLine: commandLine({
      'remote-debugging-address': '0.0.0.0',
      'remote-debugging-port': '19470',
    }),
    electronDevelopmentBuild: true,
    localDevelopmentBuild: false,
  }), (error) => error instanceof Error
    && 'reasonCode' in error
    && error.reasonCode === 'macos-electron-unsafe-chromium-switch');
});

test('macOS Electron security guard is inert on other platforms', () => {
  assert.doesNotThrow(() => assertMacOSElectronSecurity({
    platform: 'win32',
    commandLine: commandLine({ 'no-sandbox': '' }),
  }));
});

test('ad-hoc-signed macOS development candidates use local-development Runtime defaults', () => {
  assert.equal(resolveElectronRuntimeDeploymentProfile({
    electronDevelopmentBuild: false,
    macOSLocalDevelopmentBuild: true,
  }), 'local-development');
  assert.equal(resolveElectronRuntimeDeploymentProfile({
    electronDevelopmentBuild: true,
    macOSLocalDevelopmentBuild: false,
  }), 'local-development');
  assert.equal(resolveElectronRuntimeDeploymentProfile({
    electronDevelopmentBuild: false,
    macOSLocalDevelopmentBuild: false,
  }), 'production');
});
