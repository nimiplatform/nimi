import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { setRuntimeLogger } from '@nimiplatform/kit/telemetry';
import { invoke } from '../src/shell/renderer/bridge/runtime-bridge/invoke.js';

type ElectronInvoke = (command: string, payload?: unknown) => Promise<unknown>;
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

function withElectronInvoke(invokeImpl: ElectronInvoke): void {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const windowRecord = globalThis.window as unknown as Record<string, unknown>;
  const testHook = {
    invoke: invokeImpl,
    listen: () => () => {},
  };
  globalRecord.__NIMI_ELECTRON_TEST__ = testHook;
  windowRecord.__NIMI_ELECTRON_TEST__ = testHook;
}

function clearTelemetryTestState(): void {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const windowRecord = globalThis.window as unknown as Record<string, unknown>;
  setRuntimeLogger(null);
  (globalThis.sessionStorage as { clear?: () => void }).clear?.();
  delete globalRecord.__NIMI_RENDERER_ENV__;
  delete globalRecord.__NIMI_ELECTRON_TEST__;
  delete windowRecord.__NIMI_ELECTRON_TEST__;
  delete windowRecord.__NIMI_HTML_BOOT_ID__;
}

test.beforeEach(() => {
  clearTelemetryTestState();
  (globalThis as unknown as Record<string, unknown>).__NIMI_RENDERER_ENV__ = {
    VITE_NIMI_DEBUG_BOOT: '1',
    VITE_NIMI_VERBOSE_RENDERER_LOGS: '1',
  };
});

test.afterEach(() => {
  clearTelemetryTestState();
});

test('D-TEL-005: Electron invoke emits start and success traces with a stable invokeId', async () => {
  const forwardedLogs: ForwardedRendererLog[] = [];
  withElectronInvoke(async (command, payload) => {
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
});

test('D-TEL-005: Electron invoke emits failed traces with structured bridge error fields', async () => {
  const forwardedLogs: ForwardedRendererLog[] = [];
  withElectronInvoke(async (command, payload) => {
    if (command === 'demo_fail') {
      throw JSON.stringify({
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_after_runtime_recovery',
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
      assert.equal(record.actionHint, 'retry_after_runtime_recovery');
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
  assert.equal(failedLog?.details?.actionHint, 'retry_after_runtime_recovery');
  assert.equal(failedLog?.details?.traceId, 'trace-bridge-001');
  assert.equal(failedLog?.details?.retryable, true);
  assert.equal(failedLog?.details?.userMessage, 'AI provider request timed out.');
});
