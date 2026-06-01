import { describe, expect, it } from 'vitest';
import {
  checkRuntimeDaemonVersion,
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
    expect(checkRuntimeDaemonVersion('0.2.0', '0.1.0', { strictExactMatch: true })).toMatchObject({
      ok: false,
      severity: 'fatal',
    });
    expect(checkRuntimeDaemonVersion('v0.1.0', '0.1.0')).toMatchObject({
      ok: true,
      severity: 'none',
    });
  });

  it('derives runtime daemon reachability from running state and shared version policy', () => {
    expect(isRuntimeDaemonReachable({ running: false, version: '0.1.0' }, { appVersion: '0.1.0' })).toBe(false);
    expect(isRuntimeDaemonReachable({ running: true, version: '0.1.0' }, { appVersion: '0.1.0' })).toBe(true);
    expect(isRuntimeDaemonReachable({ running: true, version: '1.0.0' }, { appVersion: '0.1.0' })).toBe(false);
  });
});
