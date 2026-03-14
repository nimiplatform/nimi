import assert from 'node:assert/strict';
import test from 'node:test';

// Stub browser globals for Node.js test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {};
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

import { checkDaemonVersion } from '../src/shell/renderer/infra/bootstrap/version-check';

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
