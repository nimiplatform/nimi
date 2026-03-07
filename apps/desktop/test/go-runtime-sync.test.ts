import assert from 'node:assert/strict';
import test from 'node:test';

import { __internal } from '../src/runtime/local-ai-runtime/go-runtime-sync.js';

test('findGoRuntimeModel prefers exact localModelId before modelId+engine', () => {
  const models = [
    {
      localModelId: '01JLOCALAI',
      modelId: 'shared-model',
      engine: 'localai',
      status: 'active',
      endpoint: 'http://127.0.0.1:1234/v1',
      capabilities: ['image'],
    },
    {
      localModelId: '01JNEXA',
      modelId: 'shared-model',
      engine: 'nexa',
      status: 'active',
      endpoint: 'http://127.0.0.1:18181/v1',
      capabilities: ['embedding'],
    },
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
    {
      localModelId: '01JLOCALAI',
      modelId: 'shared-model',
      engine: 'localai',
      status: 'active',
      endpoint: 'http://127.0.0.1:1234/v1',
      capabilities: ['chat'],
    },
    {
      localModelId: '01JNEXA',
      modelId: 'shared-model',
      engine: 'nexa',
      status: 'installed',
      endpoint: 'http://127.0.0.1:18181/v1',
      capabilities: ['embedding'],
    },
  ];

  const resolved = __internal.findGoRuntimeModel(models, {
    modelId: 'shared-model',
    engine: 'nexa',
  });

  assert.equal(resolved.model?.localModelId, '01JNEXA');
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
