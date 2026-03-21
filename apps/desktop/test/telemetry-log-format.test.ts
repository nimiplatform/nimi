import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { invoke } from '../src/shell/renderer/bridge/runtime-bridge/invoke.js';
import {
  getRendererDebugLogsForTest,
  resetRendererTelemetryStateForTest,
} from '../src/shell/renderer/bridge/runtime-bridge/logging.js';
import { createRendererFlowId } from '../src/shell/renderer/infra/telemetry/renderer-log.js';
import { emitRuntimeLog, setRuntimeLogger } from '../src/runtime/telemetry/logger.js';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type ForwardedRendererLog = {
  level?: string;
  message?: string;
  details?: Record<string, unknown>;
};

if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).window = {};
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

function withTauriInvoke(invokeImpl: TauriInvoke): void {
  const windowRecord = globalThis.window as unknown as Record<string, unknown>;
  windowRecord.__TAURI__ = {
    core: {
      invoke: invokeImpl,
    },
  };
}

function clearTelemetryTestState(): void {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const windowRecord = globalThis.window as unknown as Record<string, unknown>;
  setRuntimeLogger(null);
  resetRendererTelemetryStateForTest();
  (globalThis.sessionStorage as { clear?: () => void }).clear?.();
  delete globalRecord.__NIMI_RENDERER_ENV__;
  delete windowRecord.__TAURI__;
  delete windowRecord.__NIMI_HTML_BOOT_ID__;
}

test.beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).__NIMI_RENDERER_ENV__ = {
    VITE_NIMI_DEBUG_BOOT: '1',
    VITE_NIMI_VERBOSE_RENDERER_LOGS: '1',
  };
  clearTelemetryTestState();
  (globalThis as unknown as Record<string, unknown>).__NIMI_RENDERER_ENV__ = {
    VITE_NIMI_DEBUG_BOOT: '1',
    VITE_NIMI_VERBOSE_RENDERER_LOGS: '1',
  };
});

test.afterEach(() => {
  clearTelemetryTestState();
});

test('D-TEL-002: emitRuntimeLog normalizes messages before forwarding to the injected logger', () => {
  const captured: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    captured.push(payload as Record<string, unknown>);
  });

  emitRuntimeLog({
    area: 'bridge',
    message: 'invoke-start:http_request',
    details: { requestId: 'req-1' },
  });
  emitRuntimeLog({
    area: 'bridge',
    message: '',
  });

  assert.equal(captured.length, 2);
  assert.equal(captured[0]?.message, 'action:invoke-start:http_request');
  assert.equal(captured[0]?.area, 'bridge');
  assert.equal(captured[1]?.message, 'action:runtime-log:empty-message');
});

test('D-TEL-003: emitRuntimeLog falls back to console by log level when no logger is injected', () => {
  const infoCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const previousInfo = console.info;
  const previousWarn = console.warn;
  const previousError = console.error;
  console.info = (...args: unknown[]) => {
    infoCalls.push(args);
  };
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  console.error = (...args: unknown[]) => {
    errorCalls.push(args);
  };

  try {
    emitRuntimeLog({
      area: 'datasync',
      message: 'token-refresh:success',
      details: { ok: true },
    });
    emitRuntimeLog({
      level: 'warn',
      area: 'bridge',
      message: 'retry:retrying',
      details: { attempt: 2 },
    });
    emitRuntimeLog({
      level: 'error',
      area: 'bridge',
      message: 'retry:retry_exhausted',
      details: { reasonCode: ReasonCode.RUNTIME_UNAVAILABLE },
    });
  } finally {
    console.info = previousInfo;
    console.warn = previousWarn;
    console.error = previousError;
  }

  assert.equal(infoCalls.length, 1);
  assert.equal(infoCalls[0]?.[0], '[runtime:datasync] action:token-refresh:success');
  assert.deepEqual(infoCalls[0]?.[1], { ok: true });
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0]?.[0], '[runtime:bridge] action:retry:retrying');
  assert.deepEqual(warnCalls[0]?.[1], { attempt: 2 });
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0]?.[0], '[runtime:bridge] action:retry:retry_exhausted');
  assert.deepEqual(errorCalls[0]?.[1], { reasonCode: ReasonCode.RUNTIME_UNAVAILABLE });
});

test('D-TEL-004: createRendererFlowId uses the real exported formatter and yields unique IDs', () => {
  const flowId = createRendererFlowId('test-flow');
  const ids = Array.from({ length: 20 }, () => createRendererFlowId('uniq'));
  const unique = new Set(ids);

  const parts = flowId.split('-');
  const randomPart = parts[parts.length - 1];
  const timestampPart = parts[parts.length - 2];

  assert.ok(parts.length >= 4, `expected prefixed flow ID, got ${flowId}`);
  assert.match(randomPart || '', /^[0-9a-z]+$/, 'random segment must be base36');
  assert.match(timestampPart || '', /^[0-9a-z]+$/, 'timestamp segment must be base36');
  assert.equal(unique.size, ids.length, 'flow IDs must be unique across repeated calls');
});

test('D-TEL-005: invoke emits start and success traces with a stable invokeId', async () => {
  const forwardedLogs: ForwardedRendererLog[] = [];
  withTauriInvoke(async (command, payload) => {
    if (command === 'demo_command') {
      return { ok: true };
    }
    if (command === 'log_renderer_event') {
      forwardedLogs.push((payload as { payload: ForwardedRendererLog }).payload);
      return null;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const result = await invoke('demo_command', { payload: { answer: 42 } });
  const startLog = forwardedLogs.find((entry) => entry.message === 'action:invoke-start:demo_command');
  const successLog = forwardedLogs.find((entry) => entry.message === 'action:invoke-success:demo_command');

  assert.deepEqual(result, { ok: true });
  assert.ok(startLog, 'invoke-start log should be forwarded');
  assert.ok(successLog, 'invoke-success log should be forwarded');
  assert.equal(startLog?.level, 'info');
  assert.equal(successLog?.level, 'debug');
  assert.match(String(startLog?.details?.invokeId || ''), /^demo_command-[0-9a-f]+$/);
  assert.equal(startLog?.details?.invokeId, successLog?.details?.invokeId);
  assert.equal(startLog?.details?.sessionTraceId, successLog?.details?.sessionTraceId);
  assert.equal(getRendererDebugLogsForTest().length >= 2, true);
});

test('D-TEL-005: invoke emits failed traces and preserves structured bridge error fields', async () => {
  const forwardedLogs: ForwardedRendererLog[] = [];
  withTauriInvoke(async (command, payload) => {
    if (command === 'demo_fail') {
      throw JSON.stringify({
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_or_switch_route',
        traceId: 'trace-bridge-001',
        retryable: true,
        message: 'provider timeout',
      });
    }
    if (command === 'log_renderer_event') {
      forwardedLogs.push((payload as { payload: ForwardedRendererLog }).payload);
      return null;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  await assert.rejects(
    () => invoke('demo_fail', { payload: { shouldFail: true } }),
    (error: unknown) => {
      const record = error as {
        reasonCode?: string;
        actionHint?: string;
        traceId?: string;
        retryable?: boolean;
        details?: Record<string, unknown>;
      };
      assert.equal(record.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
      assert.equal(record.actionHint, 'retry_or_switch_route');
      assert.equal(record.traceId, 'trace-bridge-001');
      assert.equal(record.retryable, true);
      assert.equal(record.details?.userMessage, 'AI provider request timed out.');
      return true;
    },
  );

  const startLog = forwardedLogs.find((entry) => entry.message === 'action:invoke-start:demo_fail');
  const failedLog = forwardedLogs.find((entry) => entry.message === 'action:invoke-failed:demo_fail');

  assert.ok(startLog, 'invoke-start log should be forwarded');
  assert.ok(failedLog, 'invoke-failed log should be forwarded');
  assert.equal(failedLog?.level, 'error');
  assert.equal(startLog?.details?.invokeId, failedLog?.details?.invokeId);
  assert.equal(failedLog?.details?.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
  assert.equal(failedLog?.details?.actionHint, 'retry_or_switch_route');
  assert.equal(failedLog?.details?.traceId, 'trace-bridge-001');
  assert.equal(failedLog?.details?.retryable, true);
  assert.equal(failedLog?.details?.userMessage, 'AI provider request timed out.');
});
