import assert from 'node:assert/strict';
import test from 'node:test';
import { runDesktopShutdownSteps } from '../src-electron/product-update-shutdown.js';

test('critical cleanup rejection or timeout is explicitly blocking even when report resolves', async () => {
  for (const run of [() => Promise.reject(new Error('app-stop-failed')), () => new Promise(() => undefined)]) {
    let disposed = false;
    const report = await runDesktopShutdownSteps([
      { operation: 'app', critical: true, timeoutMs: 5, run },
      { operation: 'bridge', critical: false, timeoutMs: 5, run: () => { disposed = true; } },
    ]);
    assert.equal(report.criticalCleanupComplete, false); assert.equal(report.criticalFailures[0]?.operation, 'app');
    assert.equal(disposed, false);
  }
});
test('non-critical failure retains diagnostic and does not obstruct completed critical cleanup', async () => {
  const report = await runDesktopShutdownSteps([
    { operation: 'chat', critical: true, timeoutMs: 100, run: () => undefined },
    { operation: 'menu', critical: false, timeoutMs: 100, run: () => { throw new Error('menu-close-failed'); } },
  ]);
  assert.equal(report.criticalCleanupComplete, true); assert.deepEqual(report.diagnostics, [{ operation: 'menu', reason: 'menu-close-failed' }]);
});

test('ordinary teardown can finish remaining owners while the resolved report still forbids update handoff', async () => {
  let closed = false;
  const report = await runDesktopShutdownSteps([
    { operation: 'formal', critical: true, abortRemainingOnFailure: false, timeoutMs: 100, run: () => { throw new Error('formal-close-failed'); } },
    { operation: 'chat', critical: true, timeoutMs: 100, run: () => { closed = true; } },
  ]);
  assert.equal(closed, true); assert.equal(report.criticalCleanupComplete, false);
  assert.deepEqual(report.criticalFailures, [{ operation: 'formal', reason: 'formal-close-failed' }]);
});


test('product quit stops Apps before Runtime and keeps recovery UI until verified stop', async () => {
  const { runDesktopProductShutdown } = await import('../src-electron/product-update-shutdown.js');
  const calls: string[] = [];
  const steps = [
    { operation: 'app', critical: true, timeoutMs: 1000, run: () => { calls.push('app'); } },
    { operation: 'tray', critical: false, timeoutMs: 1000, run: () => { calls.push('tray'); } },
  ];
  const result = await runDesktopProductShutdown({ steps, forUpdate: false, stopRuntime: async () => { calls.push('runtime'); } });
  assert.equal(result.criticalCleanupComplete, true);
  assert.deepEqual(calls, ['app', 'runtime', 'tray']);
  calls.length = 0;
  const failed = await runDesktopProductShutdown({ steps, forUpdate: false, stopRuntime: async () => { calls.push('runtime'); throw new Error('runtime-service-unavailable'); } });
  assert.equal(failed.criticalCleanupComplete, false);
  assert.equal(failed.criticalFailures[0]?.operation, 'runtime-service');
  assert.deepEqual(calls, ['app', 'runtime']);
});

test('failed App cleanup and update handoff never stop Runtime or dispose recovery UI', async () => {
  const { runDesktopProductShutdown } = await import('../src-electron/product-update-shutdown.js');
  const calls: string[] = [];
  const steps = [
    { operation: 'app', critical: true, timeoutMs: 1000, run: () => { throw new Error('app-stop-failed'); } },
    { operation: 'tray', critical: false, timeoutMs: 1000, run: () => { calls.push('tray'); } },
  ];
  const stopRuntime = async () => { calls.push('runtime'); };
  const failed = await runDesktopProductShutdown({ steps, forUpdate: false, stopRuntime });
  assert.equal(failed.criticalCleanupComplete, false);
  assert.deepEqual(calls, []);
  const update = await runDesktopProductShutdown({ steps: steps.slice(1), forUpdate: true, stopRuntime });
  assert.equal(update.criticalCleanupComplete, true);
  assert.deepEqual(calls, []);
});
