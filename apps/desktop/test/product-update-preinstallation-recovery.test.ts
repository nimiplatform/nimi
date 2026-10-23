import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductUpdateTestHost, verifyPrivateUpdateTestFile } from './helpers/product-update-test-cache.js';
import type { DesktopProductUpdateHost } from '../src-electron/product-update-host.js';
import { ProductUpdateFailureStore } from '../src-electron/product-update-failure-store.js';
import { DesktopShutdownBlockedError, runDesktopShutdownSteps } from '../src-electron/product-update-shutdown.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { ProductUpdateError } from '../../../config/product-update-contract.mjs';
import type { ProductInstallationPorts } from '../src-electron/product-update-installation.js';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';

for (const fault of ['critical-app', 'critical-formal', 'fresh-file', 'handoff'] as const) {
  test(`real Host.stop composition recovers ${fault} only through safe current-version reinitialization`, async () => {
    const fixture = signedProductFixture(), directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-preinstall-recover-')));
    const cache = path.join(directory, 'cache'), store = new ProductUpdateFailureStore(cache, verifyPrivateUpdateTestFile);
    let requests = 0, ownersClosed = false, appCanStop = fault !== 'critical-app', quits = 0, handoffs = 0, reopened: DesktopProductUpdateHost | undefined;
    let candidateFile = '';
    const input = {
      currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: cache,
      policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key },
      fetchImpl: async (url: Parameters<typeof fetch>[0]) => {
        if (String(url).endsWith('latest.json')) { requests++; return new Response(fixture.manifestBytes.toString()); }
        return new Response(Uint8Array.from(fixture.bytes).buffer);
      }, verifyInstaller: async (file: string) => { candidateFile = file; },
    };
    const ports: ProductInstallationPorts = {
      ready: async () => true, preflight: async () => undefined,
      shutdown: async () => {
        const report = await runDesktopShutdownSteps([
          { operation: 'product-update-download', critical: true, timeoutMs: 100, run: () => host.stop() },
          { operation: 'local-app-host', critical: true, timeoutMs: 100, run: () => { if (!appCanStop) throw new Error('app-stop-failed'); } },
          { operation: 'formal-app-resources', critical: true, timeoutMs: 100, run: () => { ownersClosed = true; if (fault === 'critical-formal') throw new Error('formal-stop-failed'); } },
        ]);
        if (fault === 'fresh-file') await writeFile(candidateFile, Buffer.alloc(fixture.bytes.length));
        return report;
      },
      preserveFailure: (failure) => store.save(failure),
      handoff: async () => { handoffs++; if (fault === 'handoff') throw new ProductUpdateError('UPDATE_HANDOFF_FAILED'); },
      quit: () => { quits++; },
      reopenCurrentVersion: async () => {
        const report = await runDesktopShutdownSteps([{ operation: 'local-app-host', critical: true, timeoutMs: 100,
          run: () => { if (!appCanStop) throw new Error('app-stop-failed'); } }]);
        if (!report.criticalCleanupComplete) throw new DesktopShutdownBlockedError(report);
        await host.stop();
        // Mirrors the owner-supported relaunch boundary: a new Host and new
        // owners, not a stopped/blocked boolean flip on disposed instances.
        reopened = createProductUpdateTestHost(input);
        const failure = await store.take(); assert.ok(failure);
        reopened.restorePreinstallationFailure(failure); reopened.start(false);
      },
    };
    const host = createProductUpdateTestHost({ ...input, installation: ports });
    try {
      await host.check(); await host.install(fixture.candidate.releaseId, true);
      const reason = fault === 'fresh-file' ? 'UPDATE_ASSET_DIGEST_MISMATCH' : fault === 'handoff' ? 'UPDATE_HANDOFF_FAILED' : 'UPDATE_CRITICAL_CLEANUP_FAILED';
      assert.equal(host.status().reason, reason); assert.equal(host.status().phase, 'failed');
      assert.equal(host.status().checkAvailable, false); assert.equal(host.status().recoveryAction, 'reopen-current');
      await assert.rejects(host.check(), /UPDATE_CHECK_UNAVAILABLE/); assert.equal(requests, 2);
      await assert.rejects(host.install(fixture.candidate.releaseId, true), /UPDATE_INSTALL_NOT_READY/);
      assert.equal(host.status().reason, reason); assert.equal(host.status().recoveryAction, 'reopen-current');
      assert.equal(quits, 0); assert.equal(handoffs, fault === 'handoff' ? 1 : 0);
      if (fault === 'critical-app') {
        await host.reopenCurrentVersion(); assert.equal(reopened, undefined);
        assert.equal(host.status().recoveryError, 'UPDATE_REOPEN_BLOCKED'); assert.equal(host.status().reason, reason);
        assert.equal(ownersClosed, false); appCanStop = true;
      } else assert.equal(ownersClosed, true);
      await host.reopenCurrentVersion(); assert.ok(reopened);
      assert.equal(host.status().reason, reason, 'old stopped/disposed Host never claims restored work');
      assert.equal(reopened.status().reason, reason, 'specific cause survives the current-version restart');
      assert.equal(reopened.status().recoveryAction, 'none'); assert.equal(reopened.status().checkAvailable, true);
      await reopened.check(); assert.equal(requests, 3); assert.equal(reopened.status().phase, 'prepared');
    } finally { await host.stop(); await reopened?.stop(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('preflight failure remains retryable without quiescing or closing owners', async () => {
  const fixture = signedProductFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-preflight-'));
  let requests = 0, shutdowns = 0;
  const host = createProductUpdateTestHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key },
    fetchImpl: async (url) => String(url).endsWith('latest.json') ? (requests++, new Response(fixture.manifestBytes.toString())) : new Response(Uint8Array.from(fixture.bytes).buffer), verifyInstaller: async () => undefined,
    installation: { ready: async () => true, preflight: async () => { throw new ProductUpdateError('UPDATE_HANDOFF_INVALID'); },
      shutdown: async () => { shutdowns++; throw new Error('must not quiesce'); }, preserveFailure: async () => { throw new Error('must not persist a disposed-owner state'); },
      handoff: async () => { throw new Error('must not handoff'); }, reopenCurrentVersion: async () => { throw new Error('must not restart'); }, quit: () => { throw new Error('must not quit'); } },
  });
  try { await host.check(); await host.install(fixture.candidate.releaseId, true); assert.equal(shutdowns, 0); assert.equal(host.status().checkAvailable, true);
    assert.equal(host.status().recoveryAction, 'none'); await host.check(); assert.equal(requests, 3); }
  finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});
