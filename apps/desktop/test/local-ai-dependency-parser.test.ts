import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  parseExecutionApplyResult,
  parseExecutionPlan,
  parseProfileResolutionPlan,
  parseUnregisteredAssetDescriptor,
} from '../src/runtime/local-runtime/parsers.js';

test('parseExecutionPlan normalizes device profile and selections', () => {
  const parsed = parseExecutionPlan({
    planId: 'plan-1',
    modId: 'local-chat',
    capability: 'chat',
    deviceProfile: {
      os: 'darwin',
      arch: 'arm64',
      gpu: { available: true, vendor: 'Apple' },
      python: { available: true, version: '3.12.1' },
      npu: { available: true, ready: false, detail: 'warming' },
      diskFreeBytes: 12345,
      ports: [{ port: 8080, available: true }, { port: -1, available: false }],
    },
    entries: [
      {
        entryId: 'dep-model',
        kind: 'LOCAL_EXECUTION_ENTRY_KIND_MODEL',
        capability: 'chat',
        required: true,
        selected: true,
        preferred: true,
        warnings: ['prefer-verified'],
      },
    ],
    selectionRationale: [
      {
        entryId: 'dep-model',
        selected: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        detail: 'verified model matched',
      },
    ],
    preflightDecisions: [
      {
        entryId: 'dep-model',
        target: 'python',
        check: 'python_available',
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        detail: 'python detected',
      },
    ],
    warnings: ['npu-unavailable'],
  });

  assert.equal(parsed.deviceProfile.arch, 'arm64');
  assert.deepEqual(parsed.deviceProfile.ports, [{ port: 8080, available: true }]);
  assert.equal(parsed.entries[0]?.kind, 'asset');
  assert.equal(parsed.selectionRationale[0]?.reasonCode, ReasonCode.ACTION_EXECUTED);
  assert.equal(parsed.preflightDecisions[0]?.check, 'python_available');
});

test('parseExecutionApplyResult reuses model and service parsers', () => {
  const parsed = parseExecutionApplyResult({
    planId: 'plan-1',
    modId: 'local-chat',
    entries: [
      {
        entryId: 'dep-service',
        kind: 2,
        selected: true,
        preferred: false,
        required: true,
        warnings: [],
      },
    ],
    installedAssets: [
      {
        localAssetId: 'local-qwen',
        assetId: 'qwen3-4b',
        capabilities: ['chat'],
        engine: 'localai',
        entry: 'qwen3.gguf',
        license: 'apache-2.0',
        source: { repo: 'Qwen/Qwen3-4B', revision: 'main' },
        hashes: {},
        endpoint: 'http://127.0.0.1:1234/v1',
        status: 2,
        installedAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
      },
    ],
    services: [
      {
        serviceId: 'svc-qwen',
        title: 'Qwen Service',
        engine: 'localai',
        artifactType: 'binary',
        endpoint: 'http://127.0.0.1:1234/v1',
        capabilities: ['chat'],
        status: 2,
        installedAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
      },
    ],
    capabilities: ['chat'],
    stageResults: [
      {
        stage: 'install',
        ok: true,
      },
    ],
    preflightDecisions: [
      {
        target: 'port',
        check: 'port_available',
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        detail: 'port free',
      },
    ],
    rollbackApplied: false,
    warnings: [],
  });

  assert.equal(parsed.entries[0]?.kind, 'service');
  assert.equal(parsed.installedAssets[0]?.status, 'active');
  assert.equal(parsed.services[0]?.status, 'active');
  assert.equal(parsed.stageResults[0]?.stage, 'install');
});

test('parseProfileResolutionPlan keeps passive asset entries', () => {
  const parsed = parseProfileResolutionPlan({
    planId: 'plan-asset-profile',
    modId: 'world.nimi.local-image',
    profileId: 'balanced-fast',
    title: 'Balanced Fast',
    recommended: true,
    consumeCapabilities: ['image'],
    executionPlan: {
      planId: 'plan-asset-profile',
      modId: 'world.nimi.local-image',
      entries: [],
      selectionRationale: [],
      preflightDecisions: [],
      warnings: [],
      deviceProfile: {
        os: 'darwin',
        arch: 'arm64',
        gpu: { available: true },
        python: { available: true },
        npu: { available: false, ready: false },
        diskFreeBytes: 1,
        ports: [],
      },
    },
    assetEntries: [
      {
        entryId: 'vae-slot',
        kind: 'asset',
        assetId: 'local/flux-vae',
        assetKind: 'vae',
        engineSlot: 'vae_path',
        templateId: 'verified.flux.vae',
      },
    ],
    warnings: [],
  });

  assert.equal(parsed.assetEntries.length, 1);
  assert.equal(parsed.assetEntries[0]?.assetId, 'local/flux-vae');
  assert.equal(parsed.assetEntries[0]?.engineSlot, 'vae_path');
});

test('parseUnregisteredAssetDescriptor only accepts assetKind-based declarations', () => {
  const parsed = parseUnregisteredAssetDescriptor({
    filename: 'legacy-qwen.gguf',
    path: '/tmp/legacy-qwen.gguf',
    sizeBytes: 42,
    declaration: {
      assetKind: 'chat',
      engine: 'llama',
      modelType: 'chat',
    },
    suggestionSource: 'filename',
    confidence: 'low',
    autoImportable: false,
    requiresManualReview: true,
  });

  assert.equal(parsed.declaration?.assetKind, 'chat');
  assert.equal(parsed.declaration?.engine, 'llama');

  const legacyOnly = parseUnregisteredAssetDescriptor({
    filename: 'legacy-qwen.gguf',
    path: '/tmp/legacy-qwen.gguf',
    sizeBytes: 42,
    declaration: {
      modelType: 'chat',
      engine: 'llama',
    },
    suggestionSource: 'filename',
    confidence: 'low',
    autoImportable: false,
    requiresManualReview: true,
  });

  assert.equal(legacyOnly.declaration, undefined);
});
