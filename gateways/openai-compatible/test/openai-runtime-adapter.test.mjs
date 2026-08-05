import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenAICompatibleGateway,
  createOpenAICompatibleRuntimeAdapter,
} from '../src/index.mjs';

const IMAGE_MODELS = [{
  id: 'image-compatible',
  supported: true,
  capabilities: ['image.generate'],
}];

function fetchLoopback(gateway, request, context = {}) {
  return gateway.fetch(request, {
    remoteAddress: '127.0.0.1',
    ...context,
  });
}

test('runtime adapter runs the public SDK image helper with request identity and scenario content', async () => {
  const sdkRuns = [];
  const runtimeClient = { ai: { kind: 'runtime-ai-client' } };
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: runtimeClient,
    listImageGenerationModels: () => IMAGE_MODELS,
    async runNimiRuntimeImageGeneration(input) {
      sdkRuns.push(input);
      return {
        job: { jobId: 'job-image-1' },
        artifacts: [{
          artifactId: 'artifact-image-1',
          mimeType: 'image/png',
          bytes: Uint8Array.from([137, 80, 78, 71]),
        }],
      };
    },
    createdUnixSeconds: () => 999,
  });
  const gateway = createOpenAICompatibleGateway({
    apiKeys: ['nimi_local_test'],
    appId: 'nimi.gateway.openai-compatible',
    subjectUserId: 'local-user',
    runtime: adapter,
    idGenerator: () => 'request-image-1',
    createdUnixSeconds: () => 456,
  });

  const modelsResponse = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/models', {
      headers: { authorization: 'Bearer nimi_local_test' },
    }),
  );
  assert.equal(modelsResponse.status, 200);
  assert.deepEqual(await modelsResponse.json(), {
    object: 'list',
    data: [{
      id: 'image-compatible',
      object: 'model',
      created: 456,
      owned_by: 'nimi-runtime',
    }],
  });

  const generationResponse = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'image-compatible',
        prompt: 'Song dynasty scholar portrait',
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    }),
  );

  assert.equal(generationResponse.status, 200);
  assert.deepEqual(await generationResponse.json(), {
    created: 999,
    data: [{ b64_json: Buffer.from([137, 80, 78, 71]).toString('base64') }],
  });
  assert.deepEqual(sdkRuns, [{
    runtime: runtimeClient,
    head: {
      appId: 'nimi.gateway.openai-compatible',
      subjectUserId: 'local-user',
    },
    prompt: 'Song dynasty scholar portrait',
    count: 1,
    size: '1024x1024',
    responseFormat: 'b64_json',
    requestId: 'request-image-1',
    idempotencyKey: 'openai-compatible:request-image-1',
    labels: {
      gateway: 'openai-compatible',
      openaiEndpoint: 'images.generations',
    },
  }]);
});

test('runtime adapter delegates artifact byte reads to the injected public Runtime artifact client', async () => {
  const reads = [];
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: { ai: { kind: 'runtime-ai-client' } },
    listImageGenerationModels: () => IMAGE_MODELS,
    async runNimiRuntimeImageGeneration() {
      throw new Error('image generation should not run');
    },
    artifacts: {
      async readArtifactBytes(request, options) {
        reads.push({ request, options });
        return {
          mimeType: 'image/png',
          bytes: Uint8Array.from([1, 2, 3, 4]),
        };
      },
    },
    callOptions: { metadata: { 'x-test': 'adapter' } },
  });

  assert.deepEqual(
    await adapter.readArtifactBytes({ artifactId: 'artifact-image-1' }),
    {
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3, 4]),
    },
  );
  assert.deepEqual(reads, [{
    request: { artifactId: 'artifact-image-1' },
    options: { metadata: { 'x-test': 'adapter' } },
  }]);
});

test('runtime adapter fails closed rather than dropping unsupported SDK image fields', async () => {
  const sdkRuns = [];
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: { ai: { kind: 'runtime-ai-client' } },
    listImageGenerationModels: () => IMAGE_MODELS,
    async runNimiRuntimeImageGeneration(input) {
      sdkRuns.push(input);
      return { job: { jobId: 'job-image-1' }, artifacts: [] };
    },
  });
  const gateway = createOpenAICompatibleGateway({
    apiKeys: ['nimi_local_test'],
    appId: 'nimi.gateway.openai-compatible',
    runtime: adapter,
    idGenerator: () => 'request-image-unsupported',
  });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'image-compatible',
        prompt: 'portrait',
        output_format: 'png',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  assert.equal(sdkRuns.length, 0);
});
