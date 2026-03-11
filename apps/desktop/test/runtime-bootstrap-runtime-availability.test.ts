import assert from 'node:assert/strict';
import test from 'node:test';

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

import { isRuntimeDaemonReachable } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-runtime-availability';

test('runtime bridge status without a running daemon is not reachable even when version is missing', () => {
  assert.equal(
    isRuntimeDaemonReachable({
      running: false,
      version: undefined,
    }),
    false,
  );
});

test('runtime bridge status without a running daemon is not reachable even when version matches', () => {
  assert.equal(
    isRuntimeDaemonReachable({
      running: false,
      version: '0.1.0',
    }),
    false,
  );
});

test('running runtime daemon with a compatible version is reachable', () => {
  assert.equal(
    isRuntimeDaemonReachable({
      running: true,
      version: '0.1.0',
    }),
    true,
  );
});

test('running runtime daemon with a fatal version mismatch is not reachable', () => {
  assert.equal(
    isRuntimeDaemonReachable({
      running: true,
      version: '1.0.0',
    }),
    false,
  );
});
