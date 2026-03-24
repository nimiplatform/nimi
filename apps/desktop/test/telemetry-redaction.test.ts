import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRendererDebugLogsForTest as getShellTelemetryDebugLogsForTest,
  resetRendererDebugBufferForTest,
  sanitizeLogDetails,
} from '../../_libs/shell-telemetry/src/telemetry/debug-buffer.js';
import {
  getRendererDebugLogsForTest,
  logRendererEvent,
  resetRendererTelemetryStateForTest,
} from '../src/shell/renderer/bridge/runtime-bridge/logging';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function installRendererGlobals(): () => void {
  const previousWindow = globalThis.window;
  const previousSessionStorage = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: createStorage(),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: globalThis.window.sessionStorage,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: previousSessionStorage,
      configurable: true,
    });
  };
}

test('shell telemetry sanitizeLogDetails recursively redacts sensitive keys', () => {
  const details = sanitizeLogDetails({
    email: 'user@example.com',
    accessToken: 'secret-token',
    sessionTraceId: 'trace-123',
    nested: {
      password: 'plaintext',
      items: [
        { refreshToken: 'refresh-secret' },
      ],
    },
  });
  assert.equal(details.accessToken, '[REDACTED]');
  assert.equal(details.sessionTraceId, 'trace-123');
  assert.equal((details.nested as { password?: string }).password, '[REDACTED]');
  assert.equal(((details.nested as { items?: Array<{ refreshToken?: string }> }).items?.[0])?.refreshToken, '[REDACTED]');
});

test('shell telemetry sanitizeLogDetails handles circular objects without raw leakage', () => {
  const input: Record<string, unknown> = {
    sessionToken: 'secret-value',
  };
  input.self = input;
  const details = sanitizeLogDetails(input);
  assert.equal(details.sessionToken, '[REDACTED]');
  assert.equal(details.self, '[CIRCULAR]');
});

test('desktop renderer debug logs redact sensitive payload details', () => {
  const restoreGlobals = installRendererGlobals();
  resetRendererTelemetryStateForTest();
  resetRendererDebugBufferForTest();
  try {
    logRendererEvent({
      area: 'auth',
      message: 'action:test-redaction',
      details: {
        authorization: 'Bearer secret',
        nested: {
          cookie: 'cookie-secret',
        },
      },
    });
    const desktopLogs = getRendererDebugLogsForTest();
    assert.equal(desktopLogs.length, 1);
    const record = desktopLogs[0] as {
      details?: {
        authorization?: string;
        nested?: { cookie?: string };
      };
    };
    assert.equal(record.details?.authorization, '[REDACTED]');
    assert.equal(record.details?.nested?.cookie, '[REDACTED]');
    assert.equal(getShellTelemetryDebugLogsForTest().length, 0);
  } finally {
    resetRendererTelemetryStateForTest();
    resetRendererDebugBufferForTest();
    restoreGlobals();
  }
});
