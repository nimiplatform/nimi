import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopProductUpdateHost } from '../src-electron/product-update-host.js';
import { MacOSProductUpdateAdapter } from '../src-electron/macos-product-update-adapter.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { ProductUpdateError } from '../../../config/product-update-contract.mjs';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';

test('consent, fresh identity and critical report gate the only installer handoff; repeated intent merges', async () => {
  const fixture = signedProductFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-install-controller-'));
  const order: string[] = [];
  let checks = 0;
  const host = new DesktopProductUpdateHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key },
    fetchImpl: async (url) => { if (String(url).endsWith('latest.json')) { checks++; return new Response(fixture.manifestBytes.toString()); } return new Response(Uint8Array.from(fixture.bytes).buffer); },
    verifyInstaller: async () => { order.push('verify'); },
    installation: { ready: async () => true,
      preflight: async () => undefined, preserveFailure: async () => undefined, reopenCurrentVersion: async () => undefined,
      shutdown: async () => { order.push('critical-report'); return { criticalCleanupComplete: true, criticalFailures: [], diagnostics: [{ operation: 'menu', reason: 'menu-failed' }] }; },
      handoff: async (candidate) => { order.push('handoff'); assert.equal(candidate.release.releaseId, fixture.candidate.releaseId); },
      quit: () => { order.push('quit'); },
    },
  });
  try {
    await host.check(); assert.equal(host.status().installationAvailable, true);
    assert.equal(order.includes('handoff'), false, 'download alone grants no consent');
    const install = host.install(fixture.candidate.releaseId, true); assert.equal(install, host.install(fixture.candidate.releaseId, true)); await install;
    assert.equal(checks, 2, 'confirmation refetches current publisher admission');
    assert.equal(host.status().phase, 'handoff'); assert.equal(host.status().installationAvailable, false);
    assert.deepEqual(order.slice(-4), ['critical-report', 'verify', 'handoff', 'quit']);
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('missing consent/readiness, changed candidate, critical failure and handoff failure remain uninstalled', async () => {
  for (const fault of ['consent', 'readiness', 'candidate', 'critical', 'handoff']) {
    const first = signedProductFixture();
    const replacement = signedProductFixture({ version: '0.4.0' }, undefined, first.privateKey);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-install-negative-'));
    let checks = 0, shutdowns = 0, handoffs = 0, quits = 0;
    const host = new DesktopProductUpdateHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
      policy: { ...PRODUCT_UPDATE_POLICY, publicKey: first.key },
      fetchImpl: async (url) => { if (String(url).endsWith('latest.json')) return new Response((++checks > 1 && fault === 'candidate' ? replacement : first).manifestBytes.toString()); return new Response(Uint8Array.from(first.bytes).buffer); },
      verifyInstaller: async () => undefined,
      installation: { ready: async () => fault !== 'readiness', preflight: async () => undefined, preserveFailure: async () => undefined, reopenCurrentVersion: async () => undefined,
        shutdown: async () => { shutdowns++; return { criticalCleanupComplete: fault !== 'critical', criticalFailures: fault === 'critical' ? [{ operation: 'formal', reason: 'timeout' }] : [], diagnostics: [] }; },
        handoff: async () => { handoffs++; if (fault === 'handoff') throw new ProductUpdateError('UPDATE_HANDOFF_FAILED'); }, quit: () => { quits++; } },
    });
    try {
      await host.check(); await host.install(first.candidate.releaseId, fault !== 'consent');
      assert.equal(host.status().phase, 'failed', fault); assert.equal(quits, 0, fault);
      assert.equal(handoffs, fault === 'handoff' ? 1 : 0, fault);
      if (['consent', 'readiness', 'candidate'].includes(fault)) assert.equal(shutdowns, 0, fault);
      assert.equal(host.status().installationAvailable, false);
    } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
  }
});

test('actual production adapter stays closed outside its installed owner and rejects malformed receipt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-install-readiness-'));
  const adapter = new MacOSProductUpdateAdapter(directory, true);
  try {
    assert.equal(await adapter.ready(), false);
    await writeFile(path.join(directory, 'handoff.json'), JSON.stringify({ envelope: { payload: '', signature: '' } }), { mode: 0o600 });
    // Windows rejects this macOS receipt's POSIX ownership/mode before reading it.
    const refusal = process.platform === 'win32' ? /UPDATE_HANDOFF_INVALID/ : /UPDATE_METADATA_INVALID/;
    await assert.rejects(adapter.reconcile(async () => { throw new Error('must not read health before receipt trust'); }), refusal);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
