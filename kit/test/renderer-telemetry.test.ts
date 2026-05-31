import { afterEach, describe, expect, test, vi } from 'vitest';

import { emitRendererLog, logRendererEvent, toRendererLogMessage } from '../telemetry/src/telemetry/emit.js';
import {
  getRendererDebugLogsForTest,
  resetRendererDebugBufferForTest,
  sanitizeLogDetails,
} from '../telemetry/src/telemetry/debug-buffer.js';
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
  vi.restoreAllMocks();
});

describe('kit renderer telemetry', () => {
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
});
