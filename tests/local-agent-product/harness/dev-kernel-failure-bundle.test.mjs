import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { persistDevKernelFailureBundle } from './dev-kernel-failure-bundle.mjs';

test('sanitized failure bundle retains typed owner evidence without credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-failure-bundle-'));
  const page = {
    isClosed: () => false,
    evaluate: async (operation) => {
      const source = operation.toString();
      if (source.includes('__nimiZhiyuDevKernelEvidence')) {
        return {
          state: 'runtime-unavailable',
          session: null,
          permission: null,
          appPrivateStorage: { state: 'failed' },
          lastError: { reasonCode: 'runtime-service-untrusted' },
        };
      }
      return {
        title: 'Nimi user@example.invalid',
        lang: 'zh-CN',
        readyState: 'complete',
        bodyText: 'Bearer abc.def.ghi password=do-not-keep',
        visibleTestIds: ['zhiyu-dev-kernel-root'],
      };
    },
  };
  try {
    const file = await persistDevKernelFailureBundle({
      artifactsRoot: root,
      executionMode: 'owner-minimal',
      phase: 'carrier-boundary',
      error: Object.assign(new Error('local-app carrier rejected user@example.invalid'), {
        reasonCode: 'LOCAL_APP_CARRIER_REJECTED',
      }),
      sourceState: { sourceDigest: 'a'.repeat(64), nimiCommit: 'b'.repeat(40), realmCommit: 'c'.repeat(40) },
      desktop: { page },
      zhiyuConnections: [{ page }],
      readDesktopAuthorityProjection: async () => ({ authorizations: [{ state: 'revoked', appId: 'nimi.zhiyu' }] }),
      runtimeService: {
        serviceName: 'NimiRuntime', state: 'running', processId: 123,
        runtimeCandidateId: `dev-kernel-runtime-${'d'.repeat(32)}`,
        runtimeBinarySha256: 'e'.repeat(64), runtimeBuildRecordSha256: 'f'.repeat(64),
        sourceTreeSha256: '1'.repeat(64), checkpointCandidatePostureVerified: true,
      },
      processLedger: { snapshot: () => ({ processStarts: { runtime: 1 }, events: [{ role: 'runtime', identity: 'pid:123' }] }) },
      observations: { carrierRejected: { reasonCode: 'runtime-service-untrusted' }, email: 'user@example.invalid' },
      observedPages: [{ label: 'Desktop', consoleErrors: ['user@example.invalid'], pageErrors: [], authorizationHeaderObserved: false, secretTextObserved: false }],
    });
    const text = fs.readFileSync(file, 'utf8');
    const bundle = JSON.parse(text);
    assert.equal(bundle.acceptanceEligible, false);
    assert.equal(bundle.phase, 'carrier-boundary');
    assert.equal(bundle.typedError.reasonCode, 'LOCAL_APP_CARRIER_REJECTED');
    assert.equal(bundle.desktopAuthorityProjection.authorizations[0].state, 'revoked');
    assert.equal(bundle.runtimeCandidate.runtimeCandidateId, `dev-kernel-runtime-${'d'.repeat(32)}`);
    assert.doesNotMatch(text, /user@example\.invalid|do-not-keep|abc\.def\.ghi/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
