import { createHash } from 'node:crypto';
import fs from 'node:fs';

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function silentWav(seconds) {
  const sampleRate = 8000;
  const durationSamples = sampleRate * Math.max(1, Math.floor(seconds));
  const dataSize = durationSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export function handleLocalAgentProviderControl({ body, manifest, manifestPath, pathname, response }) {
  if (pathname !== '/__fixture/control/provider-plan') return false;
  const checkpointId = typeof body?.checkpointId === 'string' ? body.checkpointId.trim() : '';
  const apml = typeof body?.apml === 'string' ? body.apml.trim() : '';
  if (!checkpointId || !apml) {
    json(response, 400, { message: 'provider plan requires checkpointId and apml' });
    return true;
  }
  manifest.realmFixture = manifest.realmFixture || {};
  manifest.realmFixture.providerPlanQueue = [
    ...(Array.isArray(manifest.realmFixture.providerPlanQueue) ? manifest.realmFixture.providerPlanQueue : []),
    {
      checkpointId,
      apml,
      chunks: Array.isArray(body?.chunks) ? body.chunks.map(String) : null,
      reasoningChunks: Array.isArray(body?.reasoningChunks) ? body.reasoningChunks.map(String) : [],
      streamDelayMs: Math.max(0, Math.min(10_000, Number(body?.streamDelayMs || 0))),
    },
  ];
  writeJsonFile(manifestPath, manifest);
  json(response, 200, { checkpointId, queued: manifest.realmFixture.providerPlanQueue.length });
  return true;
}

export async function handleLocalAgentProviderRequest({ manifest, manifestPath, pathname, request, response }) {
  if (request.method === 'GET' && pathname === '/v1/models') {
    json(response, 200, {
      object: 'list',
      data: [
        { id: 'runtime-agent-live-e2e', object: 'model', owned_by: 'local-agent-product-acceptance' },
        { id: 'runtime-agent-live-e2e-embedding', object: 'model', owned_by: 'local-agent-product-acceptance' },
        { id: 'gpt-image-1.5', object: 'model', owned_by: 'local-agent-product-acceptance' },
        { id: 'gpt-4o-mini-transcribe-runtime-live', object: 'model', owned_by: 'local-agent-product-acceptance' },
        { id: 'qwen3-tts-runtime-live-native-stream', object: 'model', owned_by: 'local-agent-product-acceptance' },
      ],
    });
    return true;
  }

  if (request.method === 'GET' && (pathname === '/catalog' || pathname === '/v1/catalog')) {
    json(response, 200, {
      models: [
        { id: 'gpt-image-1.5', model_id: 'gpt-image-1.5', provider: 'openai', model_type: 'image', capabilities: ['image.generate'] },
        { id: 'gpt-4o-mini-transcribe-runtime-live', model_id: 'gpt-4o-mini-transcribe-runtime-live', provider: 'openai', model_type: 'stt', capabilities: ['audio.transcribe'] },
        { id: 'qwen3-tts-runtime-live-native-stream', model_id: 'qwen3-tts-runtime-live-native-stream', provider: 'dashscope', model_type: 'tts', capabilities: ['audio.synthesize'] },
      ],
    });
    return true;
  }

  if (request.method === 'GET' && (pathname === '/healthz' || pathname === '/v1/healthz')) {
    json(response, 200, { ready: true, fixture: 'local-agent-product-acceptance' });
    return true;
  }

  if (request.method === 'POST' && pathname === '/v1/chat/completions') {
    const body = await parseBody(request);
    manifest.realmFixture = manifest.realmFixture || {};
    const isChatTrackSidecar = Array.isArray(body?.messages)
      && body.messages.some((message) => typeof message?.content === 'string'
        && message.content.includes('runtime-private Chat Track sidecar executor'));
    const queue = Array.isArray(manifest.realmFixture.providerPlanQueue) ? manifest.realmFixture.providerPlanQueue : [];
    const plan = isChatTrackSidecar ? null : queue.shift() || null;
    const checkpointId = plan?.checkpointId || (isChatTrackSidecar ? 'chat-track-sidecar' : 'default');
    manifest.realmFixture.providerPlanQueue = queue;
    manifest.realmFixture.providerRequests = [
      ...(Array.isArray(manifest.realmFixture.providerRequests) ? manifest.realmFixture.providerRequests : []),
      { method: request.method, pathname, checkpointId, body },
    ];
    manifest.realmFixture.providerResponses = [
      ...(Array.isArray(manifest.realmFixture.providerResponses) ? manifest.realmFixture.providerResponses : []),
      {
        checkpointId,
        responseKind: isChatTrackSidecar ? 'chat-track-sidecar' : 'apml',
        contentSha256: createHash('sha256').update(isChatTrackSidecar ? 'sidecar' : plan?.apml || 'default').digest('hex'),
        apml: isChatTrackSidecar ? null : plan?.apml || null,
      },
    ];
    writeJsonFile(manifestPath, manifest);
    const content = isChatTrackSidecar
      ? '<chat-track-sidecar><canonical-memory-candidates><candidate canonical-class="PUBLIC_SHARED" policy-reason="stable_product_acceptance_relationship"><semantic><subject>LocalAgent</subject><predicate>relationship_preference</predicate><object>maintains continuity with the current user</object><confidence>1</confidence></semantic></candidate></canonical-memory-candidates></chat-track-sidecar>'
      : plan?.apml || '<message id="local-agent-product-acceptance">我记得我们的共同经历，也会保持自己的性格与边界。</message>';
    if (body?.stream === true) {
      response.statusCode = 200;
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('content-type', 'text/event-stream');
      response.setHeader('cache-control', 'no-cache');
      for (const reasoning of plan?.reasoningChunks || []) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning }, finish_reason: null }] })}\n\n`);
      }
      const chunks = Array.isArray(plan?.chunks) && plan.chunks.length > 0 ? plan.chunks : [content];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`);
      if (plan?.streamDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, plan.streamDelayMs));
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 32, completion_tokens: 18, total_tokens: 50 } })}\n\n`);
      response.end('data: [DONE]\n\n');
      return true;
    }
    json(response, 200, {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 32, completion_tokens: 18, total_tokens: 50 },
    });
    return true;
  }

  if (request.method === 'POST' && pathname === '/v1/images/generations') {
    json(response, 200, {
      data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    });
    return true;
  }

  if (request.method === 'POST' && pathname === '/v1/audio/transcriptions') {
    const rawBody = await readRawBody(request);
    if (!rawBody.includes('gpt-4o-mini-transcribe-runtime-live')) {
      json(response, 400, { error: { code: 'TRANSCRIPTION_ROUTE_MISMATCH', message: 'unexpected transcription model' } });
      return true;
    }
    json(response, 200, { text: 'Runtime full-chain fixture transcript.', usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 } });
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/v1/services/audio/tts/customization') {
    json(response, 200, { output: { voice: 'runtime-live-voice' } });
    return true;
  }

  if (request.method === 'POST' && (pathname === '/v1/audio/speech' || pathname === '/api/v1/services/aigc/multimodal-generation/generation')) {
    const body = await parseBody(request);
    const audio = silentWav(body?.stream === true ? 3 : 1);
    response.statusCode = 200;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('content-type', 'audio/wav');
    if (body?.stream === true) {
      const firstChunkSize = Math.min(16 * 1024, audio.byteLength);
      response.write(audio.subarray(0, firstChunkSize));
      await new Promise((resolve) => setTimeout(resolve, 250));
      response.end(audio.subarray(firstChunkSize));
    } else response.end(audio);
    return true;
  }

  if (request.method === 'POST' && pathname === '/v1/embeddings') {
    const body = await parseBody(request);
    const values = Array.isArray(body?.input) ? body.input : [body?.input];
    json(response, 200, {
      object: 'list',
      data: values.map((_, index) => ({ object: 'embedding', index, embedding: [0.11, 0.22, 0.33, 0.44] })),
      model: 'runtime-agent-live-e2e-embedding',
      usage: { prompt_tokens: Math.max(1, values.length), total_tokens: Math.max(1, values.length * 4) },
    });
    return true;
  }

  return false;
}
