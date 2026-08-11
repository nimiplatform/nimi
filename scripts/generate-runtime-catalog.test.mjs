import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { generateProviderCatalog } from './generate-runtime-catalog.mjs';

const duplicateVideoFixture = path.join(
  import.meta.dirname,
  'fixtures',
  'runtime-catalog-duplicate-video-mode.source.yaml',
);

test('real catalog generator rejects duplicate canonical video modes from source YAML', () => {
  const source = YAML.parse(fs.readFileSync(duplicateVideoFixture, 'utf8'));
  assert.throws(
    () => generateProviderCatalog(source),
    /video_generation\.modes contains duplicate normalized mode: t2v/u,
  );
});

function staticTextProviderWithSource(source, provider = 'source-test') {
  return {
    schema_version: 3,
    provider,
    catalog_version: 'source-test-v1',
    runtime: {
      inventory_mode: 'static_source',
      runtime_plane: 'remote',
    },
    defaults: {
      model_type: 'chat',
      context_window_tokens: 8192,
      pricing: {
        unit: 'request',
        input: 'unknown',
        output: 'unknown',
        currency: 'USD',
        as_of: '2026-08-09',
        notes: 'Test pricing.',
      },
    },
    sources: [source],
    models: [{
      model_id: 'private-model-route',
      capabilities: ['text.generate'],
      updated_at: '2026-08-09',
      source_ids: [source.source_id],
    }],
  };
}

test('authenticated provider inventory source remains explicit in the generated source_ref', () => {
  const source = {
    source_id: 'authenticated_inventory',
    source_kind: 'authenticated_provider_inventory',
    url: 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0',
    retrieved_at: '2026-08-09',
    note: 'Authenticated non-public provider inventory observation.',
  };

  const generated = generateProviderCatalog(staticTextProviderWithSource(source, 'openai_codex'));
  assert.deepEqual(generated.models[0].source_ref, {
    source_kind: 'authenticated_provider_inventory',
    url: source.url,
    retrieved_at: source.retrieved_at,
    note: source.note,
  });
});

test('authenticated provider inventory source fails closed without an exact secure endpoint', () => {
  const source = {
    source_id: 'authenticated_inventory',
    source_kind: 'authenticated_provider_inventory',
    url: 'https://provider.example',
    retrieved_at: '2026-08-09',
    note: 'Authenticated non-public provider inventory observation.',
  };

  assert.throws(
    () => generateProviderCatalog(staticTextProviderWithSource(source, 'openai_codex')),
    /authenticated_provider_inventory source authenticated_inventory must use an exact HTTPS endpoint/u,
  );
});

test('authenticated provider inventory source rejects a different secure endpoint', () => {
  const source = {
    source_id: 'authenticated_inventory',
    source_kind: 'authenticated_provider_inventory',
    url: 'https://provider.example/private/models?client_version=1.0.0',
    retrieved_at: '2026-08-09',
    note: 'Authenticated non-public provider inventory observation.',
  };

  assert.throws(
    () => generateProviderCatalog(staticTextProviderWithSource(source, 'openai_codex')),
    /authenticated_provider_inventory source authenticated_inventory must use the exact official inventory endpoint for provider openai_codex/u,
  );
});

test('authenticated provider inventory endpoint is bound to its owning provider', () => {
  const source = {
    source_id: 'authenticated_inventory',
    source_kind: 'authenticated_provider_inventory',
    url: 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0',
    retrieved_at: '2026-08-09',
    note: 'Authenticated non-public provider inventory observation.',
  };

  assert.throws(
    () => generateProviderCatalog(staticTextProviderWithSource(source, 'dashscope')),
    /authenticated_provider_inventory source authenticated_inventory is not admitted for provider dashscope/u,
  );
});

test('catalog source retrieved_at must be an exact calendar date', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/private-model-route',
    retrieved_at: 'not-a-date',
    note: 'Provider documentation.',
  };

  assert.throws(
    () => generateProviderCatalog(staticTextProviderWithSource(source)),
    /source provider_documentation must include retrieved_at as YYYY-MM-DD/u,
  );
});

test('catalog source kind vocabulary is closed', () => {
  const source = {
    source_id: 'unsupported_source',
    source_kind: 'internal_note',
    url: 'https://provider.example/models',
    retrieved_at: '2026-08-09',
    note: 'Unsupported source kind.',
  };

  assert.throws(
    () => generateProviderCatalog(staticTextProviderWithSource(source)),
    /source unsupported_source has unsupported source_kind/u,
  );
});
