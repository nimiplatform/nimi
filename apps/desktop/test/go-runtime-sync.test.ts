import assert from 'node:assert/strict';
import test from 'node:test';

import { __internal } from '../src/runtime/local-runtime/go-runtime-sync.js';
import type { GoRuntimeModelEntry } from '../src/runtime/local-runtime/go-runtime-sync-types.js';

function makeGoRuntimeModelEntry(overrides: Partial<GoRuntimeModelEntry>): GoRuntimeModelEntry {
  return {
    localModelId: '01JMODEL',
    modelId: 'shared-model',
    engine: 'localai',
    status: 'active',
    endpoint: 'http://127.0.0.1:1234/v1',
    capabilities: ['chat'],
    entry: 'model.gguf',
    license: 'apache-2.0',
    source: {
      repo: 'nimiplatform/shared-model',
      revision: 'main',
    },
    hashes: {},
    installedAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

test('findGoRuntimeModel prefers exact localModelId before modelId+engine', () => {
  const models = [
    makeGoRuntimeModelEntry({ localModelId: '01JLOCALAI', capabilities: ['image'] }),
    makeGoRuntimeModelEntry({ localModelId: '01JNEXA', engine: 'nexa', endpoint: 'http://127.0.0.1:18181/v1', capabilities: ['embedding'] }),
  ];

  const resolved = __internal.findGoRuntimeModel(models, {
    modelId: 'shared-model',
    engine: 'nexa',
    localModelId: '01JLOCALAI',
  });

  assert.equal(resolved.model?.localModelId, '01JLOCALAI');
  assert.equal(resolved.matchedBy, 'localModelId');
});

test('findGoRuntimeModel resolves duplicate modelId by engine', () => {
  const models = [
    makeGoRuntimeModelEntry({ localModelId: '01JLOCALAI', capabilities: ['chat'] }),
    makeGoRuntimeModelEntry({ localModelId: '01JNEXA', engine: 'nexa', status: 'installed', endpoint: 'http://127.0.0.1:18181/v1', capabilities: ['embedding'] }),
  ];

  const resolved = __internal.findGoRuntimeModel(models, {
    modelId: 'shared-model',
    engine: 'nexa',
  });

  assert.equal(resolved.model?.localModelId, '01JNEXA');
  assert.equal(resolved.matchedBy, 'modelId+engine');
});

test('findGoRuntimeModel ignores removed fallback duplicates', () => {
  const models = [
    makeGoRuntimeModelEntry({ localModelId: '01JREMOVED', status: 'removed', capabilities: ['image'] }),
  ];

  const resolved = __internal.findGoRuntimeModel(models, {
    modelId: 'shared-model',
    engine: 'localai',
  });

  assert.equal(resolved.model, null);
  assert.equal(resolved.matchedBy, undefined);
});

test('findGoRuntimeModel prefers non-removed duplicate over removed fallback', () => {
  const models = [
    makeGoRuntimeModelEntry({ localModelId: '01JREMOVED', status: 'removed', capabilities: ['image'] }),
    makeGoRuntimeModelEntry({ localModelId: '01JACTIVE', capabilities: ['image'] }),
  ];

  const resolved = __internal.findGoRuntimeModel(models, {
    modelId: 'shared-model',
    engine: 'localai',
  });

  assert.equal(resolved.model?.localModelId, '01JACTIVE');
  assert.equal(resolved.matchedBy, 'modelId+engine');
});

test('parseGoRuntimeModelEntry normalizes status and engine', () => {
  const parsed = __internal.parseGoRuntimeModelEntry({
    localModelId: '01JTEST',
    modelId: 'vision-model',
    engine: 'LOCALAI',
    status: 2,
    capabilities: ['image'],
  });

  assert.equal(parsed.engine, 'localai');
  assert.equal(parsed.status, 'active');
});

test('parseGoRuntimeModelEntry marks unspecified status as ambiguous installed', () => {
  const parsed = __internal.parseGoRuntimeModelEntry({
    localModelId: '01JTEST',
    modelId: 'vision-model',
    engine: 'localai',
    status: 0,
  });

  assert.equal(parsed.status, 'installed');
  assert.equal(parsed.statusRaw, '0');
});

test('findGoRuntimeModel matches modelId and engine case-insensitively', () => {
  const resolved = __internal.findGoRuntimeModel([
    {
      localModelId: '01JACTIVE',
      modelId: 'Local-Import/Z_Image_Turbo-Q4_K',
      engine: 'LOCALAI',
      status: 'active',
      endpoint: 'http://127.0.0.1:1234/v1',
      capabilities: ['image'],
      entry: 'z_image_turbo-Q4_K.gguf',
      license: 'apache-2.0',
      source: { repo: 'repo', revision: 'main' },
      hashes: {},
      installedAt: '2026-03-08T00:00:00Z',
      updatedAt: '2026-03-08T00:00:00Z',
    },
  ], {
    modelId: 'local/local-import/z_image_turbo-q4_k',
    engine: 'localai',
  });

  assert.equal(resolved.model?.localModelId, '01JACTIVE');
  assert.equal(resolved.matchedBy, 'modelId+engine');
});

test('statusPriority prefers explicit installed over ambiguous unspecified status', () => {
  assert.equal(__internal.statusPriority('installed', 'LOCAL_MODEL_STATUS_INSTALLED'), 2);
  assert.equal(__internal.statusPriority('installed', '0'), 3);
});

test('toDesktopLocalModelRecord preserves structured runtime metadata', () => {
  const record = __internal.toDesktopLocalModelRecord({
    localModelId: '01JMODEL',
    modelId: 'local-import/z_image_turbo-q4_k',
    engine: 'localai',
    status: 'installed',
    statusRaw: 'LOCAL_MODEL_STATUS_INSTALLED',
    endpoint: 'http://127.0.0.1:1234/v1',
    capabilities: ['image'],
    entry: 'z_image_turbo-Q4_K.gguf',
    license: 'apache-2.0',
    source: {
      repo: 'unsloth/z-image',
      revision: 'main',
    },
    hashes: {
      sha256: 'abc',
    },
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:01:00Z',
    healthDetail: 'ready',
    engineConfig: {
      backend: 'stablediffusion-ggml',
    },
  });

  assert.deepEqual(record, {
    localModelId: '01JMODEL',
    modelId: 'local/local-import/z_image_turbo-q4_k',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K.gguf',
    files: ['z_image_turbo-Q4_K.gguf'],
    license: 'apache-2.0',
    source: {
      repo: 'unsloth/z-image',
      revision: 'main',
    },
    hashes: {
      sha256: 'abc',
    },
    tags: [],
    knownTotalSizeBytes: undefined,
    endpoint: 'http://127.0.0.1:1234/v1',
    status: 'installed',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:01:00Z',
    healthDetail: 'ready',
    engineConfig: {
      backend: 'stablediffusion-ggml',
    },
  });
});
