import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  OpenAICompatibleGatewayError,
  assertLoopbackHost,
  createOpenAICompatibleGateway,
  createOpenAICompatibleGatewayHttpServer,
} from '../src/index.mjs';

function createRuntime({ models, artifacts, onSubmit, readArtifactBytes } = {}) {
  return {
    async listImageGenerationModels() {
      return models ?? [
        {
          id: 'z-image-turbo-local',
          supported: true,
          capabilities: ['image.generate'],
        },
      ];
    },
    async runImageGenerationJob(request) {
      onSubmit?.(request);
      return {
        createdUnixSeconds: 123,
        artifacts: artifacts ?? [
          {
            mimeType: 'image/png',
            bytes: Uint8Array.from([137, 80, 78, 71]),
          },
        ],
      };
    },
    readArtifactBytes,
  };
}

function createGateway(options = {}) {
  return createOpenAICompatibleGateway({
    apiKeys: ['nimi_local_test'],
    appId: 'nimi.gateway.openai-compatible',
    subjectUserId: 'local-user',
    runtime: createRuntime(options.runtime),
    idGenerator: () => 'imgjob-test',
    createdUnixSeconds: () => 456,
    ...options.gateway,
  });
}

function fetchLoopback(gateway, request, context = {}) {
  return gateway.fetch(request, {
    remoteAddress: '127.0.0.1',
    ...context,
  });
}

function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.on('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestJson({ port, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('image generation endpoint maps OpenAI request into a local Runtime image job', async () => {
  const submitted = [];
  const gateway = createGateway({
    runtime: {
      onSubmit(request) {
        submitted.push(request);
      },
    },
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
        model: 'z-image-turbo-local',
        prompt: 'Song dynasty scholar, reference portrait style',
        size: '1024x1024',
        n: 1,
        response_format: 'b64_json',
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    created: 123,
    data: [
      {
        b64_json: Buffer.from([137, 80, 78, 71]).toString('base64'),
      },
    ],
  });
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0], {
    appId: 'nimi.gateway.openai-compatible',
    subjectUserId: 'local-user',
    requestId: 'imgjob-test',
    idempotencyKey: 'openai-compatible:imgjob-test',
    scenario: {
      kind: 'image',
      prompt: 'Song dynasty scholar, reference portrait style',
      count: 1,
      size: '1024x1024',
      responseFormat: 'b64_json',
    },
    labels: {
      gateway: 'openai-compatible',
      openaiEndpoint: 'images.generations',
    },
  });
});

test('image generation endpoint fails closed when bearer token is missing', async () => {
  const gateway = createGateway({
    runtime: {
      onSubmit() {
        throw new Error('runtime must not be called without auth');
      },
    },
  });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'z-image-turbo-local',
        prompt: 'portrait',
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'OpenAI-compatible gateway requires a valid local API key.',
      type: 'invalid_request_error',
      code: 'NIMI_GATEWAY_AUTH_REQUIRED',
    },
  });
});

test('image generation endpoint fails closed when loopback proof is missing even with a valid local API key', async () => {
  const gateway = createGateway({
    runtime: {
      onSubmit() {
        throw new Error('runtime must not be called without loopback proof');
      },
    },
  });

  const response = await gateway.fetch(
    new Request('http://203.0.113.10/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'z-image-turbo-local',
        prompt: 'portrait',
      }),
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'OpenAI-compatible gateway v1 requires verified loopback client evidence.',
      type: 'invalid_request_error',
      code: 'NIMI_GATEWAY_LOOPBACK_REQUIRED',
    },
  });
});

test('image generation endpoint accepts official OpenAI request fields', async () => {
  const submitted = [];
  const gateway = createGateway({
    runtime: {
      onSubmit(request) {
        submitted.push(request);
      },
    },
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
        model: 'z-image-turbo-local',
        prompt: 'portrait',
        user: 'external-user',
        quality: 'hd',
        style: 'vivid',
        output_format: 'png',
        background: 'transparent',
        moderation: 'low',
        partial_images: 2,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0].scenario, {
    kind: 'image',
    prompt: 'portrait',
    count: 1,
    quality: 'hd',
    style: 'vivid',
    outputFormat: 'png',
    background: 'transparent',
    moderation: 'low',
    partialImages: 2,
    user: 'external-user',
    responseFormat: 'url',
  });
});

test('image generation endpoint rejects non-standard companion fields before Runtime execution', async () => {
  const gateway = createGateway({
    runtime: {
      onSubmit() {
        throw new Error('runtime must not be called for non-standard image options');
      },
    },
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
        model: 'z-image-turbo-local',
        prompt: 'portrait',
        companion: 'ideogram4_uncond',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'images.generations.companion is not supported by this gateway.',
      type: 'invalid_request_error',
      code: 'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
    },
  });
});

test('image generation endpoint rejects n greater than one until multi-artifact Runtime output is admitted', async () => {
  const gateway = createGateway({
    runtime: {
      onSubmit() {
        throw new Error('runtime must not be called for n > 1');
      },
    },
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
        model: 'z-image-turbo-local',
        prompt: 'portrait',
        n: 2,
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'images.generations.n greater than 1 is not supported by this gateway.',
      type: 'invalid_request_error',
      code: 'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
    },
  });
});

test('models endpoint projects Runtime-supported OpenAI capability targets', async () => {
  const gateway = createGateway({
    runtime: {
      models: [
        {
          id: 'z-image-turbo-local',
          supported: true,
          capabilities: ['image.generate'],
        },
        {
          id: 'ideogram4-local',
          supported: false,
          capabilities: ['image.generate'],
        },
        {
          id: 'text-local',
          supported: true,
          capabilities: ['text.generate'],
        },
      ],
    },
  });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/models', {
      headers: {
        authorization: 'Bearer nimi_local_test',
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    object: 'list',
    data: [
      {
        id: 'z-image-turbo-local',
        object: 'model',
        created: 456,
        owned_by: 'nimi-runtime',
      },
      {
        id: 'text-local',
        object: 'model',
        created: 456,
        owned_by: 'nimi-runtime',
      },
    ],
  });
});

test('models endpoint rejects catalog entries without capabilities', async () => {
  const gateway = createGateway({
    runtime: {
      models: [
        {
          id: 'broken-image-model',
          supported: true,
          capabilities: [],
        },
      ],
    },
  });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/models', {
      headers: {
        authorization: 'Bearer nimi_local_test',
      },
    }),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'Runtime compatibility model projection entries require id and capabilities.',
      type: 'invalid_request_error',
      code: 'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
    },
  });
});

test('gateway construction requires explicit app identity and Runtime projection client', () => {
  assert.throws(
    () => createOpenAICompatibleGateway({
      apiKeys: ['nimi_local_test'],
      appId: '',
      runtime: createRuntime(),
    }),
    (error) => {
      assert.equal(error instanceof OpenAICompatibleGatewayError, true);
      assert.equal(error.code, 'NIMI_GATEWAY_APP_ID_REQUIRED');
      return true;
    },
  );
});

test('default url response format returns a gateway artifact handle backed by bytes', async () => {
  const gateway = createGateway();

  const generationResponse = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'z-image-turbo-local',
        prompt: 'portrait',
      }),
    }),
  );

  assert.equal(generationResponse.status, 200);
  const generation = await generationResponse.json();
  assert.match(generation.data[0].url, /^http:\/\/127\.0\.0\.1:43181\/v1\/artifacts\//u);

  const artifactResponse = await fetchLoopback(
    gateway,
    new Request(generation.data[0].url, {
      headers: {
        authorization: 'Bearer nimi_local_test',
      },
    }),
  );

  assert.equal(artifactResponse.status, 200);
  assert.equal(artifactResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await artifactResponse.arrayBuffer()), Uint8Array.from([137, 80, 78, 71]));
});

test('url response rejects non-loopback publicBaseUrl and accepts numeric loopback origins only', async () => {
  assert.throws(
    () => createGateway({
      gateway: {
        publicBaseUrl: 'http://evil.example',
      },
    }),
    (error) => {
      assert.equal(error instanceof OpenAICompatibleGatewayError, true);
      assert.equal(error.code, 'NIMI_GATEWAY_PUBLIC_BASE_URL_INVALID');
      return true;
    },
  );

  const gateway = createGateway({
    gateway: {
      artifactIdGenerator: () => 'artifact-proof',
      publicBaseUrl: 'http://127.0.0.1:45123',
    },
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
        model: 'z-image-turbo-local',
        prompt: 'portrait',
      }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data[0].url, 'http://127.0.0.1:45123/v1/artifacts/artifact-proof');
});

test('server-supplied loopback origin prevents Host header artifact URL injection', async () => {
  const gateway = createGateway({
    gateway: {
      artifactIdGenerator: () => 'artifact-proof',
    },
  });
  const server = createOpenAICompatibleGatewayHttpServer(gateway);
  const address = await listenLoopback(server);
  try {
    const response = await requestJson({
      port: address.port,
      path: '/v1/images/generations',
      headers: {
        host: 'evil.example',
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'z-image-turbo-local',
        prompt: 'portrait',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.body.data[0].url,
      `http://127.0.0.1:${address.port}/v1/artifacts/artifact-proof`,
    );
  } finally {
    await closeServer(server);
  }
});

test('b64_json response reads Runtime artifact bytes when inline bytes are not returned', async () => {
  const reads = [];
  const gateway = createGateway({
    runtime: {
      artifacts: [
        {
          artifactId: 'runtime-artifact-1',
          mimeType: 'image/png',
        },
      ],
      async readArtifactBytes(request) {
        reads.push(request);
        return {
          mimeType: 'image/png',
          bytes: Uint8Array.from([1, 2, 3, 4]),
        };
      },
    },
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
        model: 'z-image-turbo-local',
        prompt: 'portrait',
        response_format: 'b64_json',
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    created: 123,
    data: [
      {
        b64_json: Buffer.from([1, 2, 3, 4]).toString('base64'),
      },
    ],
  });
  assert.deepEqual(reads, [{ artifactId: 'runtime-artifact-1' }]);
});

test('namespaced OpenAI routes are not accepted after the standard v1 hardcut', async () => {
  const gateway = createGateway();

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/openai/v1/models', {
      headers: {
        authorization: 'Bearer nimi_local_test',
      },
    }),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'OpenAI-compatible gateway route is not supported: /openai/v1/models',
      type: 'invalid_request_error',
      code: 'NIMI_GATEWAY_ROUTE_NOT_FOUND',
    },
  });
});

test('gateway construction fails closed without a local API key', () => {
  assert.throws(
    () => createOpenAICompatibleGateway({
      apiKeys: [],
      allowUnauthenticatedLoopback: true,
      appId: 'nimi.gateway.openai-compatible',
      runtime: createRuntime(),
    }),
    (error) => {
      assert.equal(error instanceof OpenAICompatibleGatewayError, true);
      assert.equal(error.code, 'NIMI_GATEWAY_API_KEY_REQUIRED');
      return true;
    },
  );
});

test('healthz requires loopback proof but not local API key', async () => {
  const gateway = createGateway();

  const missingRemoteResponse = await gateway.fetch(
    new Request('http://127.0.0.1:43181/healthz'),
  );
  assert.equal(missingRemoteResponse.status, 403);

  const loopbackResponse = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/healthz'),
  );
  assert.equal(loopbackResponse.status, 200);
  assert.deepEqual(await loopbackResponse.json(), { status: 'ok' });
});

test('localhost is not accepted as a loopback proof or bind host in v1', async () => {
  const gateway = createGateway();

  const response = await gateway.fetch(
    new Request('http://127.0.0.1:43181/v1/models', {
      headers: {
        authorization: 'Bearer nimi_local_test',
      },
    }),
    { remoteAddress: 'localhost' },
  );

  assert.equal(response.status, 403);
  assert.throws(
    () => assertLoopbackHost('localhost'),
    /only supports numeric loopback hosts/u,
  );
});

test('server helpers are exported and keep v1 bound to loopback', () => {
  const gateway = createGateway();

  const server = createOpenAICompatibleGatewayHttpServer(gateway);
  assert.equal(typeof server.listen, 'function');
  assertLoopbackHost('127.0.0.1');
  assertLoopbackHost('::1');
  assert.throws(
    () => assertLoopbackHost('0.0.0.0'),
    /only supports numeric loopback hosts/u,
  );
  server.close();
});
