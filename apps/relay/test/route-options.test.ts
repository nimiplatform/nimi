import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMediaRouteConnectors, loadRouteOptions, normalizeCapability } from '../src/main/route/route-options.js';

function createRuntimeStub(input: {
  localModels?: unknown[];
  localError?: Error;
  connectors?: Array<{ connectorId: string; provider: string; label?: string; status?: string }>;
  connectorListError?: Error;
  connectorModelErrorById?: Record<string, Error>;
  connectorModelsById?: Record<string, unknown[]>;
}) {
  return {
    local: {
      listLocalModels: async () => {
        if (input.localError) {
          throw input.localError;
        }
        return { models: input.localModels ?? [] };
      },
    },
    connector: {
      listConnectors: async () => {
        if (input.connectorListError) {
          throw input.connectorListError;
        }
        return { connectors: input.connectors ?? [] };
      },
      listConnectorModels: async ({ connectorId }: { connectorId: string }) => {
        const failure = input.connectorModelErrorById?.[connectorId];
        if (failure) {
          throw failure;
        }
        return { models: input.connectorModelsById?.[connectorId] ?? [], nextPageToken: '' };
      },
    },
  };
}

describe('route options hardcut', () => {
  it('marks connector model load failures as degraded instead of pretending the connector has no models', async () => {
    const runtime = createRuntimeStub({
      localModels: [{
        localModelId: 'local-1',
        modelId: 'qwen3',
        engine: 'llama',
        status: 2,
        capabilities: ['text.generate'],
      }],
      connectors: [{
        connectorId: 'conn-1',
        provider: 'openai',
        label: 'OpenAI',
        status: 'ready',
      }],
      connectorModelErrorById: {
        'conn-1': new Error('connector models unavailable'),
      },
    });

    const result = await loadRouteOptions(runtime as never, null);

    assert.equal(result.loadStatus, 'degraded');
    assert.equal(result.local.status, 'ready');
    assert.equal(result.connectors.length, 1);
    assert.equal(result.connectors[0]?.modelsStatus, 'unavailable');
    assert.match(result.connectors[0]?.modelsError ?? '', /connector models unavailable/);
    assert.deepEqual(result.connectors[0]?.models, []);
    assert.equal(result.issues[0]?.scope, 'connector-models');
  });

  it('returns failed when both local and connector discovery are unavailable', async () => {
    const runtime = createRuntimeStub({
      localError: new Error('local runtime unavailable'),
      connectorListError: new Error('connector registry unavailable'),
    });

    const result = await loadRouteOptions(runtime as never, null);

    assert.equal(result.loadStatus, 'failed');
    assert.equal(result.local.status, 'unavailable');
    assert.match(result.local.error ?? '', /local runtime unavailable/);
    assert.equal(result.connectors.length, 0);
    assert.equal(result.issues.length, 2);
  });

  it('media route connector discovery surfaces failure instead of returning an empty-success list', async () => {
    const runtime = createRuntimeStub({
      connectorListError: new Error('connector registry unavailable'),
    });

    const result = await loadMediaRouteConnectors(runtime as never, 'image.generate');

    assert.equal(result.loadStatus, 'failed');
    assert.equal(result.connectors.length, 0);
    assert.equal(result.issues[0]?.scope, 'connectors');
    assert.match(result.issues[0]?.message ?? '', /connector registry unavailable/);
  });
});

describe('capability normalization', () => {
  it('normalizeCapability maps Go runtime aliases to canonical form', () => {
    assert.equal(normalizeCapability('chat'), 'text.generate');
    assert.equal(normalizeCapability('embedding'), 'text.embed');
    assert.equal(normalizeCapability('embed'), 'text.embed');
    assert.equal(normalizeCapability('image'), 'image.generate');
    assert.equal(normalizeCapability('video'), 'video.generate');
    assert.equal(normalizeCapability('music'), 'music.generate');
    assert.equal(normalizeCapability('tts'), 'audio.synthesize');
    assert.equal(normalizeCapability('speech'), 'audio.synthesize');
    assert.equal(normalizeCapability('stt'), 'audio.transcribe');
    assert.equal(normalizeCapability('transcription'), 'audio.transcribe');
  });

  it('normalizeCapability passes through already-canonical values', () => {
    assert.equal(normalizeCapability('text.generate'), 'text.generate');
    assert.equal(normalizeCapability('image.generate'), 'image.generate');
    assert.equal(normalizeCapability('audio.synthesize'), 'audio.synthesize');
  });

  it('normalizeCapability passes through unknown values unchanged', () => {
    assert.equal(normalizeCapability('unknown_cap'), 'unknown_cap');
  });

  it('normalizeCapability trims and lowercases input', () => {
    assert.equal(normalizeCapability('  Chat '), 'text.generate');
    assert.equal(normalizeCapability('EMBEDDING'), 'text.embed');
  });

  it('includes local models with raw "chat" capability from Go runtime', async () => {
    const runtime = createRuntimeStub({
      localModels: [{
        localModelId: 'local-1',
        modelId: 'qwen3',
        engine: 'llama',
        status: 2,
        capabilities: ['chat'],
      }],
    });

    const result = await loadRouteOptions(runtime as never, null);

    assert.equal(result.local.models.length, 1);
    assert.equal(result.local.models[0]?.localModelId, 'local-1');
    assert.ok(result.local.models[0]?.capabilities.includes('text.generate'));
    assert.ok(!result.local.models[0]?.capabilities.includes('chat'));
  });

  it('includes local models with canonical "text.generate" capability', async () => {
    const runtime = createRuntimeStub({
      localModels: [{
        localModelId: 'local-1',
        modelId: 'qwen3',
        engine: 'llama',
        status: 2,
        capabilities: ['text.generate'],
      }],
    });

    const result = await loadRouteOptions(runtime as never, null);
    assert.equal(result.local.models.length, 1);
  });

  it('excludes models without any text.generate-equivalent capability', async () => {
    const runtime = createRuntimeStub({
      localModels: [{
        localModelId: 'local-1',
        modelId: 'embed-model',
        engine: 'llama',
        status: 2,
        capabilities: ['embedding'],
      }],
    });

    const result = await loadRouteOptions(runtime as never, null);
    assert.equal(result.local.models.length, 0);
  });
});
