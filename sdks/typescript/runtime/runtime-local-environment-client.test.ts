import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeLocalEnvironmentClient,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  type NimiRuntimeLocalEnvironmentRpc,
} from './runtime-local-environment-client';
import {
  projectNimiRuntimeLocalCatalogItemDescriptor,
  projectNimiRuntimeLocalInstallPlanDescriptor,
  projectNimiRuntimeLocalVerifiedAssetDescriptor,
} from './runtime-local-environment-client-projections';
import { LocalAssetKind, LocalEngineRuntimeMode } from '../core-generated/runtime-typed-client';

test('Runtime local environment client does not expose the retired LocalAsset and local Profile planes', () => {
  const client = createNimiRuntimeLocalEnvironmentClient({
    local: {} as NimiRuntimeLocalEnvironmentRpc,
  });
  for (const method of [
    'listAssets',
    'snapshot',
    'rescanBundle',
    'inspectRemoval',
    'remove',
    'start',
    'stop',
    'scanUnregisteredAssets',
    'resolveProfile',
    'applyProfile',
  ]) {
    assert.equal(method in client, false, `${method} must stay outside the canonical client`);
  }
});

test('Runtime local environment state helpers retain Runtime-owned state semantics', () => {
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobActiveState('DOWNLOADING'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobActiveState('ready'), false);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobRetryableState('failed'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobRetryableState('running'), false);
});

test('Runtime local projections retain canonical content identity and exact acquisition size', () => {
  const verified = projectNimiRuntimeLocalVerifiedAssetDescriptor({
    templateId: 'template.multi', assetId: 'template.multi', kind: LocalAssetKind.CHAT,
    contentId: `sha256:${'c'.repeat(64)}`, totalSizeBytes: '123', files: ['model.bin'],
    hashes: { 'model.bin': `sha256:${'a'.repeat(64)}` }, fileCount: 1,
  } as never);
  assert.equal(verified.contentId, `sha256:${'c'.repeat(64)}`);
  assert.equal(verified.totalSizeBytes, 123);

  const catalog = projectNimiRuntimeLocalCatalogItemDescriptor({
    itemId: 'catalog.multi', capabilities: ['text.generate'], totalSizeBytes: '123',
    engineRuntimeMode: LocalEngineRuntimeMode.SUPERVISED,
  } as never);
  assert.equal(catalog.totalSizeBytes, 123);

  const plan = projectNimiRuntimeLocalInstallPlanDescriptor({
    planId: 'plan.multi', capabilities: ['text.generate'], totalSizeBytes: '123',
    engineRuntimeMode: LocalEngineRuntimeMode.SUPERVISED,
  } as never);
  assert.equal(plan.totalSizeBytes, 123);
});

test('Runtime local projections reject unspecified engine execution semantics', () => {
  assert.throws(() => projectNimiRuntimeLocalCatalogItemDescriptor({
    itemId: 'catalog.unknown-mode', capabilities: ['text.generate'],
    engineRuntimeMode: LocalEngineRuntimeMode.UNSPECIFIED,
  } as never), /unknown engine runtime mode/);
  assert.throws(() => projectNimiRuntimeLocalInstallPlanDescriptor({
    planId: 'plan.unknown-mode', engineRuntimeMode: LocalEngineRuntimeMode.UNSPECIFIED,
  } as never), /unknown engine runtime mode/);
});
