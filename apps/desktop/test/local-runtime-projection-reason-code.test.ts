import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAssetRecord,
  parseServiceDescriptor,
} from '../src/runtime/local-runtime/parsers.js';
import { parseAssetHealth } from '../src/runtime/local-runtime/parsers-runtime-events.js';

test('local runtime parsers preserve projection reasonCode for assets, health, and services', () => {
  const asset = parseAssetRecord({
    localAssetId: 'speech-asset',
    assetId: 'speech/qwen3tts',
    kind: 'tts',
    engine: 'speech',
    entry: 'model.bin',
    files: ['model.bin'],
    license: 'apache-2.0',
    source: { repo: 'Qwen/Qwen3-TTS', revision: 'main' },
    hashes: {},
    status: 'unhealthy',
    installedAt: '2026-04-17T00:00:00Z',
    updatedAt: '2026-04-17T00:00:00Z',
    healthDetail: 'speech probe missing expected model',
    reasonCode: 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED',
  });
  assert.equal(asset.reasonCode, 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED');

  const health = parseAssetHealth({
    localAssetId: 'speech-asset',
    status: 'unhealthy',
    detail: 'speech probe missing required capability',
    endpoint: 'http://127.0.0.1:8330/v1',
    reasonCode: 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED',
  });
  assert.equal(health.reasonCode, 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED');

  const service = parseServiceDescriptor({
    serviceId: 'speech-service',
    title: 'Speech Service',
    engine: 'speech',
    artifactType: 'attached-endpoint',
    endpoint: 'http://127.0.0.1:8330/v1',
    capabilities: ['audio.synthesize'],
    localAssetId: 'speech-asset',
    status: 'unhealthy',
    detail: 'speech probe request failed',
    reasonCode: 'AI_LOCAL_SPEECH_HOST_INIT_FAILED',
    installedAt: '2026-04-17T00:00:00Z',
    updatedAt: '2026-04-17T00:00:00Z',
  });
  assert.equal(service.reasonCode, 'AI_LOCAL_SPEECH_HOST_INIT_FAILED');
});
