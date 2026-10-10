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
