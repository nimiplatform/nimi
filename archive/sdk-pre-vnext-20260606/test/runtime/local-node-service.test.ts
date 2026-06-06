import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import {
  normalizeLocalRuntimeProviderAdapter,
  normalizeLocalRuntimeServiceStatus,
  parseLocalRuntimeNodeDescriptor,
  parseLocalRuntimeServiceDescriptor,
} from '../../src/runtime/index.js';

test('parseLocalRuntimeServiceDescriptor projects Runtime service wire status', () => {
  const parsed = parseLocalRuntimeServiceDescriptor({
    serviceId: 'speech-service',
    title: 'Speech Service',
    engine: 'speech',
    artifactType: 'attached-endpoint',
    endpoint: 'http://127.0.0.1:8330/v1',
    capabilities: ['audio.synthesize'],
    localAssetId: 'speech-asset',
    status: 'LOCAL_SERVICE_STATUS_UNHEALTHY',
    detail: 'speech probe request failed',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED,
    installedAt: '2026-04-17T00:00:00Z',
    updatedAt: '2026-04-17T00:00:00Z',
  });

  assert.equal(parsed.artifactType, 'attached-endpoint');
  assert.equal(parsed.status, 'unhealthy');
  assert.equal(parsed.reasonCode, ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED);
});

test('parseLocalRuntimeNodeDescriptor keeps provider truth empty when Runtime omits it', () => {
  const parsed = parseLocalRuntimeNodeDescriptor({
    nodeId: 'node-1',
    title: 'Runtime node',
    serviceId: 'svc-1',
    capabilities: ['text.generate'],
    adapter: 'SPEECH_NATIVE_ADAPTER',
    available: true,
    readOnly: true,
    providerHints: {
      speech: {
        preferred_adapter: 'SPEECH_NATIVE_ADAPTER',
        backend: 'qwen',
        device_id: 'default',
      },
    },
  });

  assert.equal(parsed.provider, '');
  assert.equal(parsed.adapter, 'speech_native_adapter');
  assert.equal(parsed.providerHints?.speech?.deviceId, 'default');
  assert.equal(parsed.available, true);
});

test('local Runtime service/node helpers fail closed to SDK projection defaults', () => {
  assert.equal(normalizeLocalRuntimeServiceStatus(2), 'active');
  assert.equal(normalizeLocalRuntimeServiceStatus('bad-status'), 'installed');
  assert.equal(normalizeLocalRuntimeProviderAdapter('unknown_adapter'), 'openai_compat_adapter');
});
