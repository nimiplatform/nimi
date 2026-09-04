import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  approvedCatalogTargetMatchesIntent,
  createAppsInstallIntentController,
  snapshotAppsInstallIntent,
  type AppsInstallStartResult,
} from '../src/shell/renderer/features/apps/apps-install-intent.js';
import type { ApprovedAppCatalogTarget } from '@nimiplatform/sdk/runtime/wire-types';

function catalogTarget(overrides: Partial<ApprovedAppCatalogTarget> = {}): ApprovedAppCatalogTarget {
  return {
    approvedTargetSelector: new Uint8Array([1, 2, 3]),
    observedRegistryRevision: 'a'.repeat(40),
    descriptorId: 'publisher.example@1.2.3',
    appId: 'publisher.example',
    displayName: 'Example App',
    version: '1.2.3',
    publisherGithubNamespace: 'publisher',
    sourceRepository: 'https://github.com/publisher/example',
    sourceLicenseSpdxExpression: 'MIT',
    appAccess: ['runtime.consume'],
    capabilityContractRefs: ['text.generate'],
    requiredStandardizedFeatureRefs: [],
    storagePolicyKind: 'nimi-mediated-default',
    osStorageDisclosures: [],
    targetId: 'windows-x86_64',
    os: 'windows',
    arch: 'x86_64',
    assetName: 'publisher.example-1.2.3-windows-x86_64.nimiapp',
    assetSize: '42',
    executionProfileRef: 'windows-user-mode-as-invoker-v1',
    windowsCodeSigning: 'unsigned',
    policyBlocked: false,
    policyRevision: '0',
    ...overrides,
  };
}

describe('Desktop approved App install intent', () => {
  it('copies the exact selector and Cancel creates no install request', async () => {
    const calls: Uint8Array[] = [];
    const controller = createAppsInstallIntentController({
      startInstall: async (selector) => {
        calls.push(selector);
        return { kind: 'started' };
      },
      refresh: () => undefined,
    });
    const target = catalogTarget();
    const requested = await controller.requestInstall(target);
    assert.equal(requested.kind, 'confirmation-required');
    target.approvedTargetSelector[0] = 9;
    assert.deepEqual([...controller.pending()!.approvedTargetSelector], [1, 2, 3]);
    assert.equal(controller.pending()!.publisherGithubNamespace, 'publisher');
    controller.cancel();
    assert.equal((await controller.confirm()).kind, 'no-pending-intent');
    assert.equal(calls.length, 0);
  });

  it('consumes unsigned confirmation once and signed Install is already explicit intent', async () => {
    const calls: Uint8Array[] = [];
    const controller = createAppsInstallIntentController({
      startInstall: async (selector) => {
        calls.push(selector);
        return { kind: 'started' };
      },
      refresh: () => undefined,
    });
    await controller.requestInstall(catalogTarget());
    assert.deepEqual((await controller.confirm()), { kind: 'start-result', result: { kind: 'started' } });
    assert.equal((await controller.confirm()).kind, 'no-pending-intent');
    assert.equal(calls.length, 1);

    const signed = await controller.requestInstall(catalogTarget({
      windowsCodeSigning: 'signed', observedSigningSubject: 'CN=Publisher',
    }));
    assert.deepEqual(signed, { kind: 'start-result', result: { kind: 'started' } });
    assert.equal(calls.length, 2);
  });

  it('keeps policy blocking separate from stale selection and refreshes both', async () => {
    let refreshes = 0;
    let next: AppsInstallStartResult = { kind: 'stale-selection' };
    const controller = createAppsInstallIntentController({
      startInstall: async () => next,
      refresh: () => { refreshes += 1; },
    });
    await controller.requestInstall(catalogTarget());
    assert.deepEqual((await controller.confirm()), {
      kind: 'start-result', result: { kind: 'stale-selection' },
    });
    assert.equal(refreshes, 1);

    const blockedBeforeIntent = await controller.requestInstall(catalogTarget({
      policyBlocked: true, policyReason: 'security-review-revoked', policyRevision: '7',
    }));
    assert.deepEqual(blockedBeforeIntent, {
      kind: 'policy-blocked', reason: 'security-review-revoked', revision: '7',
    });
    assert.equal(refreshes, 2);

    next = { kind: 'policy-blocked', reason: 'new-block', revision: '8' };
    await controller.requestInstall(catalogTarget());
    assert.deepEqual((await controller.confirm()), { kind: 'start-result', result: next });
    assert.equal(refreshes, 3);
  });

  it('invalidates an open confirmation when policy or exact selector facts change', () => {
    const target = catalogTarget();
    const intent = snapshotAppsInstallIntent(target);
    assert.equal(approvedCatalogTargetMatchesIntent(target, intent), true);
    assert.equal(approvedCatalogTargetMatchesIntent(catalogTarget({ policyBlocked: true }), intent), false);
    assert.equal(approvedCatalogTargetMatchesIntent(catalogTarget({ observedRegistryRevision: 'c'.repeat(40) }), intent), false);
    assert.equal(approvedCatalogTargetMatchesIntent(catalogTarget({ approvedTargetSelector: new Uint8Array([1, 2, 4]) }), intent), false);
  });

  it('fails closed on an unsupported target or native posture', () => {
    assert.throws(() => snapshotAppsInstallIntent(catalogTarget({ targetId: 'macos-aarch64', os: 'macos', arch: 'aarch64' })), /Unsupported App Catalog target/u);
    assert.throws(() => snapshotAppsInstallIntent(catalogTarget({ windowsCodeSigning: 'invalid' })), /Unsupported Windows native posture/u);
    assert.throws(() => snapshotAppsInstallIntent(catalogTarget({ windowsCodeSigning: 'signed' })), /Contradictory Windows native posture/u);
    assert.throws(() => snapshotAppsInstallIntent(catalogTarget({ observedSigningSubject: 'CN=Publisher' })), /Contradictory Windows native posture/u);
  });

  it('ships truthful unsigned disclosure in both Desktop locales', () => {
    for (const locale of ['en', 'zh']) {
      const document = JSON.parse(readFileSync(new URL(`../src/shell/renderer/locales/${locale}/56-Apps.json`, import.meta.url), 'utf8')) as {
        catalog: { unsignedConfirmMessage: string };
        sourceBadge: { verified: string };
      };
      assert.match(document.catalog.unsignedConfirmMessage, /sandbox/iu);
      assert.match(document.catalog.unsignedConfirmMessage, locale === 'en' ? /neither .* guarantees safety/iu : /不保证安全/u);
      assert.match(document.catalog.unsignedConfirmMessage, locale === 'en' ? /non-elevated|administrator/iu : /非提权|管理员/u);
      assert.doesNotMatch(document.sourceBadge.verified, /certif|认证/iu);
    }
  });
});
