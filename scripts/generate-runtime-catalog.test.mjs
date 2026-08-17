import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { generateProviderCatalog, localVariantContentId } from './generate-runtime-catalog.mjs';
import { readYamlResource } from './lib/yaml-resource.mjs';

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

test('local multi-file identity sorts Qwen speech files by relative path', () => {
  const variant = {
    files: [
      'model.safetensors',
      'config.json',
      'speech_tokenizer/model.safetensors',
    ],
    hashes: {
      'model.safetensors': `sha256:${'a'.repeat(64)}`,
      'config.json': `sha256:${'b'.repeat(64)}`,
      'speech_tokenizer/model.safetensors': `sha256:${'c'.repeat(64)}`,
    },
  };
  assert.equal(
    localVariantContentId(variant, 'Qwen speech fixture'),
    'sha256:4a9ad32c68b9ff1e0abfe12ebda22c69e5695a2e7b4e5264c901cbc0b5887803',
  );
});

test('local speech recipes and empty executable custody are propagated', () => {
  const source = readYamlResource(path.join(
    import.meta.dirname,
    '..',
    'runtime',
    'catalog',
    'source',
    'providers',
    'local',
  ));
  const generated = generateProviderCatalog(source);
  const speech = generated.loadout_recipes.filter((recipe) => (
    recipe.capability_contract === 'audio.synthesize' || recipe.capability_contract === 'audio.transcribe'
  ));
  assert.equal(speech.length, 6);
  const byID = new Map(speech.map((recipe) => [recipe.recipe_id, recipe]));
  for (const recipeID of ['voxcpm2', 'qwen3-tts-customvoice', 'qwen3-tts-base', 'qwen3-tts-voicedesign', 'qwen3-asr', 'qwen3-asr-transformers']) {
    assert.deepEqual(byID.get(recipeID).custody, []);
  }
  assert.deepEqual(byID.get('voxcpm2').slot_metadata[0].recommended_variant_ids, [
    'local.tts.voxcpm2.standard.cuda',
    'local.tts.voxcpm2.standard.cpu',
    'local.tts.voxcpm2.mlx.metal',
  ]);
  assert.deepEqual(byID.get('voxcpm2').slot_metadata[0].model_contract, {
    format: 'safetensors',
    architecture: 'voxcpm2',
    artifact_role: 'tts_model',
    required_files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    backend_contracts: {
      standard: {
        tensor_contract: 'voxcpm2-main-v1',
        audio_vae_files: ['audiovae.safetensors', 'audiovae.pth'],
      },
      mlx: {
        tensor_contract: 'voxcpm2-mlx-bundle-v1',
        forbidden_files: ['audiovae.safetensors', 'audiovae.pth', 'tokenization_voxcpm2.py'],
      },
    },
  });
  assert.equal(Object.hasOwn(generated.loadout_recipes.find((recipe) => recipe.recipe_id === 'llama.text-embed.gguf.v1'), 'custody'), false);
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

test('model features are normalized, validated, and propagated', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/private-model-route',
    retrieved_at: '2026-08-09',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].features = [' Input.Image ', 'INPUT.IMAGE', 'input.audio'];

  const generated = generateProviderCatalog(doc);
  assert.deepEqual(generated.models[0].features, ['input.image', 'input.audio']);
});

test('model features reject names outside the capability contract', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/private-model-route',
    retrieved_at: '2026-08-09',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].features = ['input.mask'];

  assert.throws(
    () => generateProviderCatalog(doc),
    /feature input\.mask is not allowed by its capability contracts/u,
  );
});

test('voice.create is canonical and propagates its source feature', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/voice-creation',
    retrieved_at: '2026-08-11',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].capabilities = ['voice.create'];
  doc.models[0].features = ['input.audio'];
  delete doc.models[0].context_window_tokens;

  const generated = generateProviderCatalog(doc);
  assert.deepEqual(generated.models[0].capabilities, ['voice.create']);
  assert.deepEqual(generated.models[0].features, ['input.audio']);
});

test('retired voice workflow capability tokens are rejected', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/voice-creation',
    retrieved_at: '2026-08-11',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].capabilities = ['voice_workflow.voice_clone'];
  delete doc.models[0].context_window_tokens;

  assert.throws(
    () => generateProviderCatalog(doc),
    /canonical capability tokens only/u,
  );
});

test('video.generate models admit input.image', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/private-model-route',
    retrieved_at: '2026-08-09',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].capabilities = ['video.generate'];
  doc.models[0].features = ['input.image'];

  const generated = generateProviderCatalog(doc);
  assert.deepEqual(generated.models[0].features, ['input.image']);
});

test('image-conditioned video modes require input.image', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/video-generation',
    retrieved_at: '2026-08-11',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].capabilities = ['video.generate'];
  doc.models[0].video_generation = {
    modes: ['i2v_first_frame'],
    input_roles: { i2v_first_frame: ['prompt', 'first_frame'] },
    limits: { duration_sec: { min: 1, max: 8 } },
    options: { supports: ['duration_sec'] },
    outputs: { video_url: true },
  };

  assert.throws(
    () => generateProviderCatalog(doc),
    /image-conditioned video modes without feature input\.image/u,
  );
});

test('video.generate models reject features outside input.image', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/private-model-route',
    retrieved_at: '2026-08-09',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].capabilities = ['video.generate'];
  doc.models[0].features = ['input.video'];

  assert.throws(
    () => generateProviderCatalog(doc),
    /feature input\.video is not allowed by its capability contracts/u,
  );
});

test('model features reject capabilities without a feature contract', () => {
  const source = {
    source_id: 'provider_documentation',
    source_kind: 'provider_documentation',
    url: 'https://provider.example/docs/models/private-model-route',
    retrieved_at: '2026-08-09',
    note: 'Provider documentation.',
  };
  const doc = staticTextProviderWithSource(source);
  doc.models[0].capabilities = ['text.embed'];
  doc.models[0].features = ['input.image'];
  delete doc.models[0].context_window_tokens;

  assert.throws(
    () => generateProviderCatalog(doc),
    /declares features without a feature-bearing capability contract/u,
  );
});

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
