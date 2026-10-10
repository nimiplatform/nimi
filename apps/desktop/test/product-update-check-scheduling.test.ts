import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopProductUpdateHost } from '../src-electron/product-update-host.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';

for (const reason of ['UPDATE_AUTHORIZATION_CANCELED', 'UPDATE_INSTALL_FAILED']) {
  test(`new available owner restores manual and periodic checking after ${reason} handoff is safely cleared`, async () => {
    const fixture = signedProductFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-schedule-'));
    let requests = 0, clearCalls = 0;
    const host = new DesktopProductUpdateHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
      policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key, checkIntervalMs: 30 },
      fetchImpl: async (url) => String(url).endsWith('latest.json') ? (requests++, new Response(fixture.manifestBytes.toString())) : new Response(Uint8Array.from(fixture.bytes).buffer), verifyInstaller: async () => undefined });
    try {
      host.projectActivation('failed', fixture.candidate, reason); // pointer-startup deliberately did not call start
      await host.checkAfterFailedHandoffCleared(() => true, async () => { clearCalls++; return true; }); await host.check();
      assert.equal(clearCalls, 1); assert.ok(requests >= 1); assert.equal(host.status().phase, 'prepared');
      const manualRequests = requests;
      const deadline = Date.now() + 1_000;
      while (requests <= manualRequests && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(requests > manualRequests, 'automatic timer must perform the next check without a click');
    } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('pending helper, unavailable owners and stopped old Host cannot re-enable scheduling', async () => {
  const host = new DesktopProductUpdateHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: '/unused',
    policy: { ...PRODUCT_UPDATE_POLICY, checkIntervalMs: 10 }, fetchImpl: async () => { throw new Error('must not check'); }, verifyInstaller: async () => undefined });
  await assert.rejects(host.checkAfterFailedHandoffCleared(() => true, async () => false), /UPDATE_CHECK_UNAVAILABLE/);
  await assert.rejects(host.checkAfterFailedHandoffCleared(() => false, async () => { throw new Error('must not clear'); }), /UPDATE_CHECK_UNAVAILABLE/);
  let available = true;
  await assert.rejects(host.checkAfterFailedHandoffCleared(() => available, async () => { available = false; return true; }), /UPDATE_CHECK_UNAVAILABLE/);
  await host.stop();
  await assert.rejects(host.checkAfterFailedHandoffCleared(() => true, async () => { throw new Error('must not revive old Host'); }), /UPDATE_CHECK_UNAVAILABLE/);
});

test('active installation cannot clear a handoff or start another checker', async () => {
  const fixture = signedProductFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-active-schedule-'));
  let enter!: () => void, release!: () => void, clears = 0;
  const entered = new Promise<void>((resolve) => { enter = resolve; }), waiting = new Promise<void>((resolve) => { release = resolve; });
  const host = new DesktopProductUpdateHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key }, fetchImpl: async (url) => String(url).endsWith('latest.json') ? new Response(fixture.manifestBytes.toString()) : new Response(Uint8Array.from(fixture.bytes).buffer), verifyInstaller: async () => undefined,
    installation: { ready: async () => true, preflight: async () => undefined, preserveFailure: async () => undefined, reopenCurrentVersion: async () => undefined,
      shutdown: async () => { enter(); await waiting; return { criticalCleanupComplete: false, criticalFailures: [{ operation: 'app', reason: 'stop-failed' }], diagnostics: [] }; },
      handoff: async () => { throw new Error('must not install'); }, quit: () => { throw new Error('must not quit'); } },
  });
  try {
    await host.check(); const installing = host.install(fixture.candidate.releaseId, true); await entered;
    await assert.rejects(host.checkAfterFailedHandoffCleared(() => true, async () => { clears++; return true; }), /UPDATE_CHECK_UNAVAILABLE/);
    assert.equal(clears, 0); release(); await installing;
  } finally { release(); await host.stop(); await rm(directory, { recursive: true, force: true }); }
});
