import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenAICompatibleGateway,
  createOpenAICompatibleRuntimeAdapter,
} from '../src/index.mjs';

const routeTargetRef = {
  kind: 'local-runtime',
  version: 'v2',
  profileBindingId: 'local-runtime:image:z-image-turbo',
};

const durableTargetRef = {
  target: {
    oneofKind: 'localRuntime',
    localRuntime: {
      version: 'v2',
      ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:image:z-image-turbo' },
    },
  },
};

function fetchLoopback(gateway, request, context = {}) {
  return gateway.fetch(request, {
    remoteAddress: '127.0.0.1',
    ...context,
  });
}

function createRouteSnapshot() {
  return {
    capability: 'image.generate',
    selectedTargetRef: null,
    inventory: {
      capability: 'image.generate',
      targets: [
        {
          targetRef: routeTargetRef,
          display: {
            label: 'Z Image Turbo',
            model: 'z-image-turbo',
            provider: 'local',
          },
          readiness: {
            status: 'installed',
          },
          compatibility: {
            capabilities: ['image.generate'],
          },
          evidence: {
            source: 'local-runtime',
            localAssetId: 'image:z-image-turbo',
            resolvedModelId: 'z-image-turbo',
            engine: 'z-image',
            runtimeStatus: 'installed',
          },
        },
        {
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:text:llama',
          },
          display: {
            label: 'Text Llama',
            model: 'llama',
            provider: 'local',
          },
          readiness: {
            status: 'installed',
          },
          compatibility: {
            capabilities: ['text.generate'],
          },
          evidence: {
            source: 'local-runtime',
            localAssetId: 'text:llama',
            resolvedModelId: 'llama',
            engine: 'llama',
            runtimeStatus: 'installed',
          },
        },
      ],
    },
  };
}

test('runtime adapter projects SDK route image targets and runs the public SDK image helper through the gateway', async () => {
  const routeCalls = [];
  const sdkRuns = [];
  const convertedTargetRefs = [];
  const runtimeClient = { ai: { kind: 'runtime-ai-client' } };
  const routeOptionsClient = { kind: 'runtime-route-options-client' };
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: runtimeClient,
    routeOptionsClient,
    listNimiRuntimeRouteOptions(client, input) {
      routeCalls.push({ client, input });
      return createRouteSnapshot();
    },
    toRuntimeDurableTargetRef(targetRef) {
      convertedTargetRefs.push(targetRef);
      return durableTargetRef;
    },
    async runNimiRuntimeImageGeneration(input) {
      sdkRuns.push(input);
      return {
        job: { jobId: 'job-image-1' },
        artifacts: [
          {
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
            bytes: Uint8Array.from([137, 80, 78, 71]),
          },
        ],
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
      headers: {
        authorization: 'Bearer nimi_local_test',
      },
    }),
  );

  assert.equal(modelsResponse.status, 200);
  assert.deepEqual(await modelsResponse.json(), {
    object: 'list',
    data: [
      {
        id: 'local/z-image-turbo',
        object: 'model',
        created: 456,
        owned_by: 'nimi-runtime',
      },
    ],
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
        model: 'local/z-image-turbo',
        prompt: 'Song dynasty scholar portrait',
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    }),
  );

  assert.equal(generationResponse.status, 200);
  assert.deepEqual(await generationResponse.json(), {
    created: 999,
    data: [
      {
        b64_json: Buffer.from([137, 80, 78, 71]).toString('base64'),
      },
    ],
  });
  assert.equal(routeCalls.length, 2);
  assert.deepEqual(routeCalls[0], {
    client: routeOptionsClient,
    input: {
      capability: 'image.generate',
    },
  });
  assert.deepEqual(convertedTargetRefs, [routeTargetRef]);
  assert.equal(sdkRuns.length, 1);
  assert.deepEqual(sdkRuns[0], {
    runtime: runtimeClient,
    head: {
      appId: 'nimi.gateway.openai-compatible',
      subjectUserId: 'local-user',
      modelId: 'z-image-turbo',
      routePolicy: 'local',
      targetRef: durableTargetRef,
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
      openaiModel: 'local/z-image-turbo',
    },
  });
});

test('runtime adapter delegates artifact byte reads to the injected public Runtime artifact client', async () => {
  const reads = [];
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: { ai: { kind: 'runtime-ai-client' } },
    routeOptionsClient: { kind: 'runtime-route-options-client' },
    listNimiRuntimeRouteOptions() {
      return createRouteSnapshot();
    },
    toRuntimeDurableTargetRef() {
      return durableTargetRef;
    },
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
    callOptions: {
      metadata: { 'x-test': 'adapter' },
    },
  });

  assert.deepEqual(
    await adapter.readArtifactBytes({ artifactId: 'artifact-image-1' }),
    {
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3, 4]),
    },
  );
  assert.deepEqual(reads, [
    {
      request: { artifactId: 'artifact-image-1' },
      options: { metadata: { 'x-test': 'adapter' } },
    },
  ]);
});

test('runtime adapter fails closed rather than dropping unsupported SDK image fields', async () => {
  const sdkRuns = [];
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: { ai: { kind: 'runtime-ai-client' } },
    routeOptionsClient: { kind: 'runtime-route-options-client' },
    listNimiRuntimeRouteOptions() {
      return createRouteSnapshot();
    },
    toRuntimeDurableTargetRef() {
      return durableTargetRef;
    },
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
        model: 'local/z-image-turbo',
        prompt: 'portrait',
        output_format: 'png',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  assert.equal(sdkRuns.length, 0);
});
