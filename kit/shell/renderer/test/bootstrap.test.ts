import { describe, expect, it } from 'vitest';
import {
  checkRuntimeDaemonVersion,
  createRendererEntryModuleLoader,
  describeRendererEntryFailureReason,
  ensureNimiShellRuntimeBridgeInstalled,
  isRuntimeDaemonReachable,
  safeBootstrapErrorMessage,
  withBootstrapStepTimeout,
} from '../src/bootstrap/index.js';

describe('shell renderer bootstrap primitives', () => {
  it('normalizes bootstrap error messages without throwing on non-errors', () => {
    expect(safeBootstrapErrorMessage(new Error('failed'))).toBe('failed');
    expect(safeBootstrapErrorMessage('plain')).toBe('plain');
    expect(safeBootstrapErrorMessage(null)).toBe('');
  });

  it('times out named bootstrap steps', async () => {
    await expect(withBootstrapStepTimeout(
      'slow bootstrap step',
      new Promise(() => undefined),
      1,
    )).rejects.toThrow(/slow bootstrap step timed out after 1ms/);
  });

  it('checks runtime daemon version compatibility independent of Desktop', () => {
    expect(checkRuntimeDaemonVersion(undefined, '0.1.0')).toMatchObject({
      ok: true,
      daemonVersion: null,
      severity: 'warn',
    });
    expect(checkRuntimeDaemonVersion('1.0.0', '0.1.0')).toMatchObject({
      ok: false,
      severity: 'fatal',
    });
    expect(checkRuntimeDaemonVersion('0.2.0', '0.1.0')).toMatchObject({
      ok: true,
      severity: 'warn',
    });
    expect(checkRuntimeDaemonVersion('0.0.0-dev', '0.1.0')).toMatchObject({
      ok: true,
      severity: 'none',
    });
    expect(checkRuntimeDaemonVersion('0.2.0', '0.1.0', { strictExactMatch: true })).toMatchObject({
      ok: false,
      severity: 'fatal',
    });
    expect(checkRuntimeDaemonVersion('0.0.0-dev', '0.1.0', { strictExactMatch: true })).toMatchObject({
      ok: false,
      severity: 'fatal',
    });
    expect(checkRuntimeDaemonVersion('v0.1.0', '0.1.0')).toMatchObject({
      ok: true,
      severity: 'none',
    });
  });

  it('derives runtime daemon reachability from running state and shared version policy', () => {
    expect(isRuntimeDaemonReachable({ running: false, version: undefined }, { appVersion: '0.1.0' })).toBe(false);
    expect(isRuntimeDaemonReachable({ running: false, version: '0.1.0' }, { appVersion: '0.1.0' })).toBe(false);
    expect(isRuntimeDaemonReachable({ running: true, version: '0.1.0' }, { appVersion: '0.1.0' })).toBe(true);
    expect(isRuntimeDaemonReachable({ running: true, version: '1.0.0' }, { appVersion: '0.1.0' })).toBe(false);
  });

  it('retries renderer entry dynamic imports with stage evidence', async () => {
    const stages: Array<{ stage: string; details?: Record<string, unknown> }> = [];
    let calls = 0;
    const loader = createRendererEntryModuleLoader({
      retryDelaysMs: [1],
      reportStage: (stage, details) => stages.push({ stage, details }),
      setTimeout: ((handler: TimerHandler) => {
        if (typeof handler === 'function') {
          handler();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    });

    const result = await loader.load('entry:test', async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('Failed to fetch dynamically imported module');
      }
      return { ok: true };
    });

    expect(result).toEqual({ ok: true });
    expect(stages).toEqual([
      {
        stage: 'renderer-entry-import-retry',
        details: expect.objectContaining({
          label: 'entry:test',
          attempt: 1,
          retryDelayMs: 1,
        }),
      },
    ]);
  });

  it('wraps terminal renderer entry import failures', async () => {
    const loader = createRendererEntryModuleLoader({ retryDelaysMs: [] });

    await expect(loader.load('entry:terminal', async () => {
      throw new Error('Load failed');
    })).rejects.toMatchObject({
      name: 'RendererEntryImportError',
      message: expect.stringContaining('entry:terminal failed after 1 attempt(s)'),
    });
  });

  it('serializes renderer entry failure reasons without throwing on bigint payloads', () => {
    expect(describeRendererEntryFailureReason({ message: 'bad', value: 1n })).toMatchObject({
      message: 'bad',
      raw: expect.stringContaining('"value":"1"'),
    });
  });

  it('waits for the standard shell runtime bridge before renderer bootstrap continues', async () => {
    const stages: Array<{ stage: string; details?: Record<string, unknown> }> = [];
    let attempts = 0;
    const result = await ensureNimiShellRuntimeBridgeInstalled({
      retryDelaysMs: [1],
      reportStage: (stage, details) => stages.push({ stage, details }),
      install: () => {
        attempts += 1;
        return attempts === 1
          ? { installed: false, reason: 'standard-host-preload-required' }
          : { installed: true, host: 'tauri' };
      },
      setTimeout: ((handler: TimerHandler) => {
        if (typeof handler === 'function') {
          handler();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    });

    expect(result).toEqual({ installed: true, host: 'tauri' });
    expect(attempts).toBe(2);
    expect(stages).toEqual([
      {
        stage: 'standard-shell-host-install-retry',
        details: {
          attempt: 1,
          retryDelayMs: 1,
          reason: 'standard-host-preload-required',
        },
      },
    ]);
  });

  it('keeps the default bridge wait open across the native page-load handoff', async () => {
    let attempts = 0;
    const result = await ensureNimiShellRuntimeBridgeInstalled({
      install: () => {
        attempts += 1;
        return attempts < 8
          ? { installed: false, reason: 'standard-host-preload-required' }
          : { installed: true, host: 'tauri' };
      },
      setTimeout: ((handler: TimerHandler) => {
        if (typeof handler === 'function') handler();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    });

    expect(result).toEqual({ installed: true, host: 'tauri' });
    expect(attempts).toBe(8);
  });

  it('fails closed when the standard shell runtime bridge never appears', async () => {
    await expect(ensureNimiShellRuntimeBridgeInstalled({
      retryDelaysMs: [],
      install: () => ({ installed: false, reason: 'standard-host-preload-required' }),
    })).rejects.toThrow(/Standard shell host preload was not available/);
  });
});
