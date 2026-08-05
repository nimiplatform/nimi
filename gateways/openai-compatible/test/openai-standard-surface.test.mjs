import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  createOpenAICompatibleGateway,
  createOpenAICompatibleGatewayHttpServer,
} from '../src/index.mjs';

const MODELS = [
  {
    id: 'local/text-chat',
    supported: true,
    capabilities: ['text.generate', 'text.stream'],
  },
  {
    id: 'local/z-image-turbo',
    supported: true,
    capabilities: ['image.generate'],
  },
  {
    id: 'local/speech',
    supported: true,
    capabilities: ['audio.synthesize'],
  },
  {
    id: 'local/embedder',
    supported: true,
    capabilities: ['text.embed'],
  },
];

function createRuntime(overrides = {}) {
  return {
    async listModels() {
      return MODELS;
    },
    async listImageGenerationModels() {
      return MODELS.filter((model) => model.capabilities.includes('image.generate'));
    },
    async runImageGenerationJob() {
      return {
        createdUnixSeconds: 123,
        artifacts: [{ mimeType: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71]) }],
      };
    },
    async runChatCompletion(request) {
      overrides.onChatCompletion?.(request);
      return {
        id: 'chatcmpl-runtime',
        createdUnixSeconds: 123,
        message: { role: 'assistant', content: 'pong' },
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
      };
    },
    async *streamChatCompletion(request) {
      overrides.onChatStream?.(request);
      yield { type: 'chunk', delta: { role: 'assistant' }, finishReason: null };
      yield { type: 'chunk', delta: { content: 'po' }, finishReason: null };
      yield { type: 'chunk', delta: { content: 'ng' }, finishReason: null };
      yield { type: 'chunk', delta: {}, finishReason: 'stop' };
    },
    async runResponse(request) {
      overrides.onResponse?.(request);
      return {
        id: 'resp-runtime',
        createdUnixSeconds: 123,
        outputText: 'pong',
        status: 'completed',
        usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
      };
    },
    async runEmbedding(request) {
      overrides.onEmbedding?.(request);
      return {
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        usage: { promptTokens: 3, totalTokens: 3 },
      };
    },
    async runSpeechSynthesis(request) {
      overrides.onSpeech?.(request);
      return {
        mimeType: 'audio/mpeg',
        bytes: Uint8Array.from([1, 2, 3, 4]),
      };
    },
    ...overrides.runtime,
  };
}

function createGateway(runtimeOverrides = {}) {
  return createOpenAICompatibleGateway({
    apiKeys: ['nimi_local_test'],
    appId: 'nimi.gateway.openai-compatible',
    subjectUserId: 'local-user',
    runtime: createRuntime(runtimeOverrides),
    idGenerator: () => 'request-test',
    createdUnixSeconds: () => 456,
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

test('standard models endpoint lists all Runtime-supported OpenAI capability targets', async () => {
  const gateway = createGateway();

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/models', {
      headers: { authorization: 'Bearer nimi_local_test' },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    object: 'list',
    data: [
      { id: 'local/text-chat', object: 'model', created: 456, owned_by: 'nimi-runtime' },
      { id: 'local/z-image-turbo', object: 'model', created: 456, owned_by: 'nimi-runtime' },
      { id: 'local/speech', object: 'model', created: 456, owned_by: 'nimi-runtime' },
      { id: 'local/embedder', object: 'model', created: 456, owned_by: 'nimi-runtime' },
    ],
  });
});

test('chat completions endpoint maps standard non-stream request and response', async () => {
  const submitted = [];
  const gateway = createGateway({ onChatCompletion: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/text-chat',
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0.2,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 'chatcmpl-runtime',
    object: 'chat.completion',
    created: 123,
    model: 'local/text-chat',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'pong', refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  });
  assert.equal('model' in submitted[0], false);
  assert.deepEqual(submitted[0].messages, [{ role: 'user', content: 'ping' }]);
  assert.equal(submitted[0].parameters.temperature, 0.2);
});

test('chat completions endpoint emits OpenAI SSE chunks for stream=true', async () => {
  const gateway = createGateway();

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/text-chat',
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const text = await response.text();
  assert.match(text, /"object":"chat\.completion\.chunk"/u);
  assert.match(text, /"content":"po"/u);
  assert.match(text, /data: \[DONE\]/u);
});

test('chat completions endpoint fails closed for official fields it cannot preserve', async () => {
  const submitted = [];
  const gateway = createGateway({ onChatCompletion: (request) => submitted.push(request) });

  for (const body of [
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      stream_options: { include_usage: true },
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      parallel_tool_calls: true,
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      logprobs: true,
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      top_logprobs: 2,
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      modalities: ['text', 'audio'],
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      audio: { voice: 'alloy', format: 'mp3' },
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      prediction: { type: 'content', content: 'pong' },
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      web_search_options: {},
    },
  ]) {
    const response = await fetchLoopback(
      gateway,
      new Request('http://127.0.0.1:43181/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer nimi_local_test',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  }
  assert.equal(submitted.length, 0);
});

test('chat completions endpoint rejects malformed official fields before Runtime execution', async () => {
  const submitted = [];
  const gateway = createGateway({ onChatCompletion: (request) => submitted.push(request) });

  for (const body of [
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      tools: { type: 'function' },
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      metadata: 'drop-me',
    },
    {
      model: 'local/text-chat',
      messages: [{ role: 'user', content: 'ping' }],
      stream: 'true',
    },
  ]) {
    const response = await fetchLoopback(
      gateway,
      new Request('http://127.0.0.1:43181/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer nimi_local_test',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_REQUEST_INVALID');
  }
  assert.equal(submitted.length, 0);
});

test('responses endpoint maps standard input string to Runtime response output', async () => {
  const submitted = [];
  const gateway = createGateway({ onResponse: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/text-chat',
        input: 'ping',
        instructions: 'be brief',
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 'resp-runtime',
    object: 'response',
    created_at: 123,
    status: 'completed',
    model: 'local/text-chat',
    output: [
      {
        id: 'msg-request-test',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'pong', annotations: [] }],
      },
    ],
    usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
  });
  assert.equal(submitted[0].input, 'ping');
  assert.equal(submitted[0].instructions, 'be brief');
});

test('responses endpoint rejects malformed official fields before Runtime execution', async () => {
  const submitted = [];
  const gateway = createGateway({ onResponse: (request) => submitted.push(request) });

  for (const body of [
    {
      model: 'local/text-chat',
      input: 'ping',
      tools: { type: 'function' },
    },
    {
      model: 'local/text-chat',
      input: 'ping',
      metadata: 'drop-me',
    },
    {
      model: 'local/text-chat',
      input: 'ping',
      include: 'output_text',
    },
    {
      model: 'local/text-chat',
      input: 'ping',
      reasoning: 'medium',
    },
    {
      model: 'local/text-chat',
      input: 'ping',
      text: 'plain',
    },
    {
      model: 'local/text-chat',
      input: 'ping',
      parallel_tool_calls: 'true',
    },
    {
      model: 'local/text-chat',
      input: 'ping',
      stream: 'true',
    },
  ]) {
    const response = await fetchLoopback(
      gateway,
      new Request('http://127.0.0.1:43181/v1/responses', {
        method: 'POST',
        headers: {
          authorization: 'Bearer nimi_local_test',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_REQUEST_INVALID');
  }
  assert.equal(submitted.length, 0);
});

test('responses endpoint fails closed for streaming until Runtime response streaming is wired', async () => {
  const submitted = [];
  const gateway = createGateway({ onResponse: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/text-chat',
        input: 'ping',
        stream: true,
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  assert.equal(submitted.length, 0);
});

test('embeddings endpoint maps standard input array to OpenAI embedding list', async () => {
  const submitted = [];
  const gateway = createGateway({ onEmbedding: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/embedder',
        input: ['first', 'second'],
        encoding_format: 'float',
        dimensions: 2,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    object: 'list',
    model: 'local/embedder',
    data: [
      { object: 'embedding', embedding: [0.1, 0.2], index: 0 },
      { object: 'embedding', embedding: [0.3, 0.4], index: 1 },
    ],
    usage: { prompt_tokens: 3, total_tokens: 3 },
  });
  assert.deepEqual(submitted[0].input, ['first', 'second']);
  assert.equal(submitted[0].dimensions, 2);
});

test('embeddings endpoint fails closed for base64 encoding until Runtime can preserve it', async () => {
  const submitted = [];
  const gateway = createGateway({ onEmbedding: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/embedder',
        input: 'ping',
        encoding_format: 'base64',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  assert.equal(submitted.length, 0);
});

test('audio speech endpoint maps standard TTS request to audio bytes', async () => {
  const submitted = [];
  const gateway = createGateway({ onSpeech: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/audio/speech', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/speech',
        input: 'hello',
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1.1,
        stream_format: 'audio',
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from([1, 2, 3, 4]));
  assert.equal(submitted[0].input, 'hello');
  assert.equal(submitted[0].voice, 'alloy');
  assert.equal(submitted[0].responseFormat, 'mp3');
});

test('audio speech endpoint requires the official voice field', async () => {
  const submitted = [];
  const gateway = createGateway({ onSpeech: (request) => submitted.push(request) });

  const response = await fetchLoopback(
    gateway,
    new Request('http://127.0.0.1:43181/v1/audio/speech', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nimi_local_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local/speech',
        input: 'hello',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_REQUEST_INVALID');
  assert.equal(submitted.length, 0);
});

test('standard image generation endpoint rejects provider-specific knobs outside Nimi extension space', async () => {
  const submitted = [];
  const gateway = createGateway({
    runtime: {
      async runImageGenerationJob(request) {
        submitted.push(request);
        return {
          createdUnixSeconds: 123,
          artifacts: [{ mimeType: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71]) }],
        };
      },
    },
  });

  for (const body of [
    {
      model: 'local/z-image-turbo',
      prompt: 'portrait',
      seed: 42,
    },
    {
      model: 'local/z-image-turbo',
      prompt: 'portrait',
      negative_prompt: 'low quality',
    },
  ]) {
    const response = await fetchLoopback(
      gateway,
      new Request('http://127.0.0.1:43181/v1/images/generations', {
        method: 'POST',
        headers: {
          authorization: 'Bearer nimi_local_test',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  }
  assert.equal(submitted.length, 0);
});

test('standard image generation endpoint rejects malformed stream field before Runtime execution', async () => {
  const submitted = [];
  const gateway = createGateway({
    runtime: {
      async runImageGenerationJob(request) {
        submitted.push(request);
        return {
          createdUnixSeconds: 123,
          artifacts: [{ mimeType: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71]) }],
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
        model: 'local/z-image-turbo',
        prompt: 'portrait',
        stream: 'true',
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_REQUEST_INVALID');
  assert.equal(submitted.length, 0);
});

test('standard image edit and variation routes exist and fail closed when Runtime capability is not wired', async () => {
  const gateway = createGateway({
    runtime: {
      runImageEditJob: undefined,
      runImageVariationJob: undefined,
    },
  });

  for (const path of ['/v1/images/edits', '/v1/images/variations']) {
    const response = await fetchLoopback(
      gateway,
      new Request(`http://127.0.0.1:43181${path}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer nimi_local_test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'local/z-image-turbo', prompt: 'portrait' }),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_UNSUPPORTED_FEATURE');
  }
});

test('HTTP server streams gateway response body without waiting for full completion', async () => {
  let enqueueSecondChunk;
  const gateway = {
    async fetch() {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first\n'));
          enqueueSecondChunk = () => {
            controller.enqueue(new TextEncoder().encode('second\n'));
            controller.close();
          };
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    },
  };
  const server = createOpenAICompatibleGatewayHttpServer(gateway);
  const address = await listenLoopback(server);
  try {
    const chunks = [];
    let resolveResponseDone;
    const responseDone = new Promise((resolve) => {
      resolveResponseDone = resolve;
    });
    const firstChunkPromise = new Promise((resolve, reject) => {
      const request = http.request({
        agent: false,
        host: '127.0.0.1',
        port: address.port,
        path: '/v1/chat/completions',
        method: 'POST',
      }, (response) => {
        response.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk).toString('utf8'));
          resolve(chunks.join(''));
        });
        response.on('end', resolveResponseDone);
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end('{}');
    });

    const firstObserved = await Promise.race([
      firstChunkPromise,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    assert.equal(firstObserved, 'first\n');
    enqueueSecondChunk?.();
    await responseDone;
  } finally {
    await closeServer(server);
  }
});
