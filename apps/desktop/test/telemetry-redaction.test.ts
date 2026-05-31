import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRendererDebugLogsForTest,
  resetRendererDebugBufferForTest,
  sanitizeLogDetails,
} from '../../../kit/telemetry/src/telemetry/debug-buffer.js';
import { resetRendererEmitStateForTest } from '../../../kit/telemetry/src/telemetry/emit.js';
import { resetRendererSessionTraceIdForTest } from '../../../kit/telemetry/src/telemetry/session-trace.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

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

function resetRendererTelemetryStateForTest(): void {
  resetRendererEmitStateForTest();
  resetRendererDebugBufferForTest();
  resetRendererSessionTraceIdForTest();
}

test('shell telemetry sanitizeLogDetails recursively redacts sensitive keys', () => {
  const details = sanitizeLogDetails({
    email: 'user@example.com',
    phoneNumber: '+1-555-0100',
    accessToken: 'secret-token',
    sessionTraceId: 'trace-123',
    nested: {
      password: 'plaintext',
      items: [
        { refreshToken: 'refresh-secret', shippingAddress: '1 Main St' },
      ],
    },
  });
  assert.equal(details.email, '[REDACTED]');
  assert.equal(details.phoneNumber, '[REDACTED]');
  assert.equal(details.accessToken, '[REDACTED]');
  assert.equal(details.sessionTraceId, 'trace-123');
  assert.equal((details.nested as { password?: string }).password, '[REDACTED]');
  assert.equal(((details.nested as { items?: Array<{ refreshToken?: string; shippingAddress?: string }> }).items?.[0])?.refreshToken, '[REDACTED]');
  assert.equal(((details.nested as { items?: Array<{ refreshToken?: string; shippingAddress?: string }> }).items?.[0])?.shippingAddress, '[REDACTED]');
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
    assert.equal(getRendererDebugLogsForTest().length, 1);
  } finally {
    resetRendererTelemetryStateForTest();
    resetRendererDebugBufferForTest();
    restoreGlobals();
  }
});

test('renderer telemetry wrapper forwards upstream traceId as top-level payload field', () => {
  const restoreGlobals = installRendererGlobals();
  resetRendererTelemetryStateForTest();
  try {
    logRendererEvent({
      area: 'runtime',
      message: 'action:trace-preserve',
      traceId: 'trace-upstream-001',
      flowId: 'flow-local-001',
      details: {
        operation: 'upstream-error-log',
      },
    });

    const logs = getRendererDebugLogsForTest();
    assert.equal(logs.length, 1);
    const record = logs[0] as {
      traceId?: string;
      flowId?: string;
      details?: { traceId?: string; operation?: string };
    };
    assert.equal(record.traceId, 'trace-upstream-001');
    assert.equal(record.flowId, 'flow-local-001');
    assert.equal(record.details?.traceId, undefined);
    assert.equal(record.details?.operation, 'upstream-error-log');
  } finally {
    resetRendererTelemetryStateForTest();
    restoreGlobals();
  }
});
