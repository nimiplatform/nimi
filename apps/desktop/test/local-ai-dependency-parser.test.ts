import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDependencyApplyResult,
  parseDependencyResolutionPlan,
} from '../src/runtime/local-ai-runtime/parsers.js';

test('parseDependencyResolutionPlan normalizes device profile and selections', () => {
  const parsed = parseDependencyResolutionPlan({
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
    dependencies: [
      {
        dependencyId: 'dep-model',
        kind: 'LOCAL_DEPENDENCY_KIND_MODEL',
        capability: 'chat',
        required: true,
        selected: true,
        preferred: true,
        warnings: ['prefer-verified'],
      },
    ],
    selectionRationale: [
      {
        dependencyId: 'dep-model',
        selected: true,
        reasonCode: 'LOCAL_MODEL_SELECTED',
        detail: 'verified model matched',
      },
    ],
    preflightDecisions: [
      {
        dependencyId: 'dep-model',
        target: 'python',
        check: 'python_available',
        ok: true,
        reasonCode: 'LOCAL_PREFLIGHT_PASSED',
        detail: 'python detected',
      },
    ],
    warnings: ['npu-unavailable'],
  });

  assert.equal(parsed.deviceProfile.arch, 'arm64');
  assert.deepEqual(parsed.deviceProfile.ports, [{ port: 8080, available: true }]);
  assert.equal(parsed.dependencies[0]?.kind, 'model');
  assert.equal(parsed.selectionRationale[0]?.reasonCode, 'LOCAL_MODEL_SELECTED');
  assert.equal(parsed.preflightDecisions[0]?.check, 'python_available');
});

test('parseDependencyApplyResult reuses model and service parsers', () => {
  const parsed = parseDependencyApplyResult({
    planId: 'plan-1',
    modId: 'local-chat',
    dependencies: [
      {
        dependencyId: 'dep-service',
        kind: 2,
        selected: true,
        preferred: false,
        required: true,
        warnings: [],
      },
    ],
    installedModels: [
      {
        localModelId: 'local-qwen',
        modelId: 'qwen3-4b',
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
        reasonCode: 'LOCAL_PREFLIGHT_PASSED',
        detail: 'port free',
      },
    ],
    rollbackApplied: false,
    warnings: [],
  });

  assert.equal(parsed.dependencies[0]?.kind, 'service');
  assert.equal(parsed.installedModels[0]?.status, 'active');
  assert.equal(parsed.services[0]?.status, 'active');
  assert.equal(parsed.stageResults[0]?.stage, 'install');
});
