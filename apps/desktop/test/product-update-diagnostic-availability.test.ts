import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProductUpdateFailureStore, readUpdateFailureDiagnostic } from '../src-electron/product-update-failure-store.js';
import { DesktopProductUpdateHost } from '../src-electron/product-update-host.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';
import { ProductUpdateError } from '../../../config/product-update-contract.mjs';

test('malformed, unsafe and unreadable diagnostics cannot fail the normal bootstrap or become trusted causes', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-diagnostic-')));
  const store = new ProductUpdateFailureStore(directory), file = path.join(directory, 'preinstallation-failure.json');
  let warnings = 0;
  try {
    await writeFile(file, '{', { mode: 0o600 });
    await assert.rejects(store.take(), SyntaxError);
    assert.equal(await readUpdateFailureDiagnostic(store, () => { warnings++; }), null);
    await writeFile(file, JSON.stringify({ schema: 'unknown', reason: 'UPDATE_AUTHORIZATION_CANCELED', releaseId: null, candidateVersion: null }));
    assert.equal(await readUpdateFailureDiagnostic(store, () => { warnings++; }), null);
    await chmod(file, 0o644);
    assert.equal(await readUpdateFailureDiagnostic(store, () => { warnings++; }), null);
    assert.equal(await readUpdateFailureDiagnostic({ take: async () => { throw Object.assign(new Error('unreadable'), { code: 'EACCES' }); } }, () => { warnings++; }), null);
    assert.equal(warnings, 4);
    assert.equal(await readUpdateFailureDiagnostic(store, () => { throw new Error('diagnostic log failure'); }), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ENOSPC diagnostics do not block safe current-version reopen; genuine safety failure still blocks and retains cause', async () => {
  const fixture = signedProductFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'nimi-diagnostic-save-'));
  let reopenCalls = 0, safelyReopened = 0, appCanStop = false, diagnosticWrites = 0;
  const host = new DesktopProductUpdateHost({ currentVersion: '0.2.0', target: 'macos-arm64', osVersion: '26.6.2', cacheRoot: path.join(directory, 'cache'),
    policy: { ...PRODUCT_UPDATE_POLICY, publicKey: fixture.key },
    fetchImpl: async (url) => String(url).endsWith('latest.json') ? new Response(fixture.manifestBytes.toString()) : new Response(Uint8Array.from(fixture.bytes).buffer),
    verifyInstaller: async () => undefined,
    installation: { ready: async () => true, preflight: async () => undefined,
      shutdown: async () => { await host.stop(); return { criticalCleanupComplete: false, criticalFailures: [{ operation: 'app', reason: 'stop-failed' }], diagnostics: [] }; },
      preserveFailure: async () => { diagnosticWrites++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
      reopenCurrentVersion: async () => { reopenCalls++; if (!appCanStop) throw new ProductUpdateError('UPDATE_HELPER_STOP_FAILED'); safelyReopened++; },
      handoff: async () => { throw new Error('must not install'); }, quit: () => { throw new Error('must not quit'); } },
  });
  try {
    await host.check(); await host.install(fixture.candidate.releaseId, true);
    assert.equal(host.status().reason, 'UPDATE_CRITICAL_CLEANUP_FAILED'); assert.equal(host.status().recoveryError, 'UPDATE_RECOVERY_STATE_FAILED');
    await host.reopenCurrentVersion(); assert.equal(reopenCalls, 1); assert.equal(safelyReopened, 0); assert.equal(host.status().recoveryError, 'UPDATE_REOPEN_BLOCKED');
    appCanStop = true; await host.reopenCurrentVersion(); assert.equal(reopenCalls, 2); assert.equal(safelyReopened, 1);
    assert.equal(diagnosticWrites, 3); assert.equal(host.status().reason, 'UPDATE_CRITICAL_CLEANUP_FAILED');
    assert.equal(host.status().recoveryError, 'UPDATE_RECOVERY_STATE_FAILED', 'unavailable diagnostic is never reported saved');
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});
