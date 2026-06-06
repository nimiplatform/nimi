import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeConfigConnectorDraft,
  normalizeRuntimeConfigConnectorProjection,
  runtimeConfigConnectorVendorLabel,
  runtimeConnectorProjectionToRuntimeConfigConnector,
} from '../../src/runtime/index.js';

test('runtime config connector projection normalizes app-facing drafts without owning connector truth', () => {
  const draft = createRuntimeConfigConnectorDraft({
    id: 'draft-1',
    vendor: 'OpenRouter',
  });

  assert.equal(draft.id, 'draft-1');
  assert.equal(draft.vendor, 'openrouter');
  assert.equal(draft.label, 'Openrouter Connector');
  assert.equal(draft.provider, '');
  assert.equal(draft.authMode, 'api_key');
  assert.equal(draft.scope, 'user');
  assert.equal(draft.status, 'idle');
  assert.deepEqual(draft.models, []);
});

test('runtime config connector projection preserves model capability evidence for route coverage', () => {
  const connector = normalizeRuntimeConfigConnectorProjection({
    id: 'conn-image',
    label: '',
    vendor: 'Gemini',
    scope: 'machine-global',
    models: ['image-model', 'image-model', 'empty-model'],
    modelCapabilities: {
      'image-model': ['image.generate', 'image.generate', ''],
      'empty-model': [],
    },
    status: 'healthy',
  });

  assert.equal(connector.label, 'Gemini Connector');
  assert.equal(connector.vendor, 'gemini');
  assert.equal(connector.scope, 'machine-global');
  assert.equal(connector.isSystemOwned, true);
  assert.deepEqual(connector.models, ['image-model', 'empty-model']);
  assert.deepEqual(connector.modelCapabilities, {
    'image-model': ['image.generate'],
  });
  assert.equal(connector.status, 'healthy');
});

test('runtime connector inventory projection maps to runtime config connector view state', () => {
  const connector = runtimeConnectorProjectionToRuntimeConfigConnector({
    id: 'conn-1',
    label: 'Primary',
    vendor: 'openrouter',
    provider: 'openrouter',
    authMode: 'oauth_managed',
    providerAuthProfile: 'openai_codex',
    endpoint: 'https://openrouter.ai/api/v1',
    scope: 'runtime-system',
    hasCredential: true,
    isSystemOwned: true,
    models: ['openrouter/auto'],
  });

  assert.equal(connector.status, 'idle');
  assert.equal(connector.lastCheckedAt, null);
  assert.equal(connector.lastDetail, '');
  assert.deepEqual(connector.models, ['openrouter/auto']);
});

test('runtime config connector vendor labels are presentation-only normalization', () => {
  assert.equal(runtimeConfigConnectorVendorLabel('openai_codex'), 'Openai Codex');
  assert.equal(runtimeConfigConnectorVendorLabel(''), 'Custom');
});
