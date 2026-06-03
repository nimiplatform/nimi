import { afterEach, describe, expect, test, vi } from 'vitest';

import { emitRendererLog, logRendererEvent, toRendererLogMessage } from '../telemetry/src/telemetry/emit.js';
import { emitRuntimeLog, setRuntimeLogger, toRuntimeLogMessage } from '../telemetry/src/telemetry/runtime-log.js';
import {
  getRendererDebugLogsForTest,
  resetRendererDebugBufferForTest,
  sanitizeLogDetails,
} from '../telemetry/src/telemetry/debug-buffer.js';
import { shouldForwardRendererLogLevel } from '../telemetry/src/telemetry/env.js';
import {
  createRendererFlowId,
  resetRendererSessionTraceIdForTest,
} from '../telemetry/src/telemetry/session-trace.js';

type TestGlobal = typeof globalThis & {
  __NIMI_RENDERER_ENV__?: Record<string, string>;
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  };
};

function testGlobal(): TestGlobal {
  return globalThis as TestGlobal;
}

afterEach(() => {
  delete testGlobal().__NIMI_RENDERER_ENV__;
  delete testGlobal().__NIMI_TAURI_TEST__;
  resetRendererDebugBufferForTest();
  resetRendererSessionTraceIdForTest();
  setRuntimeLogger(null);
  vi.restoreAllMocks();
});

describe('kit renderer telemetry', () => {
  test('forwards warn and error by default while dropping verbose levels', () => {
    expect(shouldForwardRendererLogLevel('warn')).toBe(true);
    expect(shouldForwardRendererLogLevel('error')).toBe(true);
    expect(shouldForwardRendererLogLevel('info')).toBe(false);
    expect(shouldForwardRendererLogLevel('debug')).toBe(false);
  });

  test('normalizes messages and creates secure flow IDs', () => {
    expect(toRendererLogMessage('capability-run')).toBe('action:capability-run');
    expect(toRendererLogMessage('phase:ready')).toBe('phase:ready');
    expect(toRendererLogMessage('')).toBe('action:renderer-log:empty-message');
    expect(createRendererFlowId('tester-capability-run')).toMatch(/^tester-capability-run-[0-9a-f]+$/);
  });

  test('sanitizes sensitive payload details recursively', () => {
    const input: Record<string, unknown> = {
      email: 'user@example.com',
      accessToken: 'secret-token',
      sessionTraceId: 'trace-123',
      nested: {
        password: 'plaintext',
      },
    };
    input.self = input;

    const details = sanitizeLogDetails(input);

    expect(details.email).toBe('[REDACTED]');
    expect(details.accessToken).toBe('[REDACTED]');
    expect(details.sessionTraceId).toBe('trace-123');
    expect((details.nested as { password?: string }).password).toBe('[REDACTED]');
    expect(details.self).toBe('[CIRCULAR]');
  });

  test('forwards through the installed renderer runtime bridge test hook', async () => {
    testGlobal().__NIMI_RENDERER_ENV__ = {
      VITE_NIMI_DEBUG_BOOT: '1',
      VITE_NIMI_VERBOSE_RENDERER_LOGS: '1',
    };
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal().__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return null;
      },
    };
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await emitRendererLog({
      level: 'info',
      area: 'tester',
      message: 'action:tester-run-recorded',
      flowId: 'flow-1',
      details: {
        capabilityId: 'text.generate',
        accessToken: 'secret-token',
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('log_renderer_event');
    const forwarded = (calls[0]?.payload as { payload?: { details?: Record<string, unknown> } }).payload;
    expect(forwarded?.details?.capabilityId).toBe('text.generate');
    expect(forwarded?.details?.accessToken).toBe('[REDACTED]');
    expect(getRendererDebugLogsForTest()).toHaveLength(1);
  });

  test('logRendererEvent persists local debug evidence without a transport', () => {
    logRendererEvent({
      level: 'warn',
      area: 'desktop',
      message: 'action:desktop-warning',
      details: {
        authorization: 'Bearer secret',
      },
    });

    const record = getRendererDebugLogsForTest()[0] as {
      details?: { authorization?: string };
    };
    expect(record.details?.authorization).toBe('[REDACTED]');
  });

  test('preserves upstream traceId as a top-level renderer payload field', () => {
    logRendererEvent({
      level: 'info',
      area: 'runtime',
      message: 'action:trace-preserve',
      traceId: 'trace-upstream-001',
      flowId: 'flow-local-001',
      details: {
        operation: 'upstream-error-log',
      },
    });

    const record = getRendererDebugLogsForTest()[0] as {
      traceId?: string;
      flowId?: string;
      details?: { traceId?: string; operation?: string };
    };
    expect(record.traceId).toBe('trace-upstream-001');
    expect(record.flowId).toBe('flow-local-001');
    expect(record.details?.traceId).toBeUndefined();
    expect(record.details?.operation).toBe('upstream-error-log');
  });

  test('normalizes runtime log messages through the shared telemetry sink', () => {
    expect(toRuntimeLogMessage('phase:ready')).toBe('phase:ready');
    expect(toRuntimeLogMessage('invoke-start:http_request')).toBe('action:invoke-start:http_request');
    expect(toRuntimeLogMessage('')).toBe('action:runtime-log:empty-message');

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
      area: '',
      message: '',
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]?.message).toBe('action:invoke-start:http_request');
    expect(captured[0]?.area).toBe('bridge');
    expect(captured[1]?.message).toBe('action:runtime-log:empty-message');
    expect(captured[1]?.area).toBe('runtime');
  });
});
