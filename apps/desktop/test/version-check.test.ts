import assert from 'node:assert/strict';
import test from 'node:test';

function installBrowserGlobals(): () => void {
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: previousSessionStorage,
      configurable: true,
    });
  };
}

import { checkDaemonVersion } from '../src/shell/renderer/infra/bootstrap/version-check';

let restoreBrowserGlobals: () => void = () => {};

test.beforeEach(() => {
  restoreBrowserGlobals = installBrowserGlobals();
});

test.afterEach(() => {
  restoreBrowserGlobals();
});

test('D-IPC-009: missing version → warn severity, ok=true', () => {
  const result = checkDaemonVersion(undefined);
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'warn');
  assert.equal(result.daemonVersion, null);
});

test('D-IPC-009: major mismatch → fatal severity, ok=false', () => {
  const result = checkDaemonVersion('1.0.0');
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'fatal');
});

test('D-IPC-009: minor/patch mismatch → warn severity, ok=true', () => {
  const result = checkDaemonVersion('0.2.0');
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'warn');
});

test('D-IPC-009: exact match → none severity, ok=true', () => {
  const result = checkDaemonVersion('0.1.0');
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'none');
});

test('D-IPC-009: explicit desktop version source is honored', () => {
  const result = checkDaemonVersion('0.2.0', '0.2.0');
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'none');
  assert.equal(result.desktopVersion, '0.2.0');
});

test('D-IPC-009: v-prefix → parsed correctly', () => {
  const result = checkDaemonVersion('v0.1.0');
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'none');
});

test('D-IPC-009: unparseable version → warn severity, ok=true', () => {
  const result = checkDaemonVersion('not-a-version');
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'warn');
});

test('D-IPC-009: packaged desktop requires exact match when strict mode is enabled', () => {
  const result = checkDaemonVersion('0.2.0', '0.1.0', { strictExactMatch: true });
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'fatal');
});

test('D-IPC-009: packaged desktop treats missing daemon version as fatal in strict mode', () => {
  const result = checkDaemonVersion(undefined, '0.1.0', { strictExactMatch: true });
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'fatal');
});

test('D-IPC-009: packaged desktop treats unparseable daemon version as fatal in strict mode', () => {
  const result = checkDaemonVersion('not-a-version', '0.1.0', { strictExactMatch: true });
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'fatal');
});
