import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopElectronRendererLogHost,
} from '../src-electron/renderer-log-host.js';

function rendererLogPayload(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    payload: {
      level: 'warn',
      area: 'bridge',
      message: 'action:invoke-failed:demo',
      traceId: 'trace-001',
      flowId: 'flow-001',
      source: 'desktop',
      costMs: 12.5,
      details: {
        command: 'demo',
        retryable: false,
      },
      ...overrides,
    },
  };
}

test('Electron renderer log host writes only structured warn/error output by default', () => {
  const lines: string[] = [];
  const host = createDesktopElectronRendererLogHost({
    verbose: false,
    writeStderr: (line) => lines.push(line),
  });

  host.commandHandlers.log_renderer_event({
    payload: rendererLogPayload(),
  });
  host.commandHandlers.log_renderer_event({
    payload: rendererLogPayload({
      level: 'info',
      message: 'action:invoke-start:demo',
    }),
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), {
    source: 'desktop',
    level: 'warn',
    area: 'bridge',
    message: 'action:invoke-failed:demo',
    traceId: 'trace-001',
    flowId: 'flow-001',
    costMs: 12.5,
    details: {
      command: 'demo',
      retryable: false,
    },
  });
});

test('Electron renderer log host writes admitted verbose levels when explicitly enabled', () => {
  const lines: string[] = [];
  const host = createDesktopElectronRendererLogHost({
    verbose: true,
    writeStderr: (line) => lines.push(line),
  });

  host.commandHandlers.log_renderer_event({
    payload: rendererLogPayload({
      level: 'debug',
      message: 'phase:invoke-complete',
      source: undefined,
      costMs: undefined,
    }),
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), {
    source: 'renderer',
    level: 'debug',
    area: 'bridge',
    message: 'phase:invoke-complete',
    traceId: 'trace-001',
    flowId: 'flow-001',
    details: {
      command: 'demo',
      retryable: false,
    },
  });
});

test('Electron renderer log host rejects non-exact or unbounded payloads', () => {
  const host = createDesktopElectronRendererLogHost({
    verbose: true,
    writeStderr: () => undefined,
  });
  const invoke = (payload: Readonly<Record<string, unknown>>) => (
    host.commandHandlers.log_renderer_event({ payload })
  );

  assert.throws(
    () => invoke({ ...rendererLogPayload(), extra: true }),
    /desktop-renderer-log-envelope-invalid/u,
  );
  assert.throws(
    () => invoke(rendererLogPayload({ level: 'fatal' })),
    /desktop-renderer-log-level-invalid/u,
  );
  assert.throws(
    () => invoke(rendererLogPayload({ message: 'not-structured' })),
    /desktop-renderer-log-message-invalid/u,
  );
  assert.throws(
    () => invoke(rendererLogPayload({ details: { value: 'x'.repeat(2049) } })),
    /desktop-renderer-log-details-invalid/u,
  );
  assert.throws(
    () => invoke(rendererLogPayload({ details: { value: 1 }, unknown: true })),
    /desktop-renderer-log-payload-invalid/u,
  );
});
