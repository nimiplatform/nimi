import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { JsonObject } from '../types';
import {
  createFixtureSourceMaterializationPacket,
  FIXTURE_SOURCE_MATERIALIZATION_JWKS,
} from './runtime-agent-live-e2e-fixture-source-packet.test-helper';
import {
  FIXTURE_IMAGE_MODEL_ID,
  FIXTURE_IMAGE_PROVIDER,
  FIXTURE_TRANSCRIPTION_MODEL_ID,
  FIXTURE_VOICE_ID,
  FIXTURE_VOICE_MODEL_ID,
  LOCAL_EMBED_DIMENSIONS,
  LOCAL_EMBED_MODEL_ID,
  LOCAL_IMAGE_PNG_BASE64,
  LOCAL_TEXT_MODEL_ID,
  OWNER_USER_ID,
  RUNTIME_ACCOUNT_ACCESS_TOKEN,
  RUNTIME_ACCOUNT_REDIRECT_URI,
  RUNTIME_ACCOUNT_REFRESH_TOKEN,
  RUNTIME_ACCOUNT_SESSION_ID,
  RUNTIME_AUTH_JWKS,
  createRuntimeAccountAccessToken,
  type RuntimeAgentLiveE2ERealmRequest,
  normalizeText,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';
import {
  RUNTIME_AGENT_LIVE_E2E_CHAT_SCENARIOS,
  type RuntimeAgentLiveE2EChatScenario,
} from './runtime-agent-live-e2e-fixture-realm-scenarios.test-helper';
export {
  runtimeAgentLiveE2EChatScenarioPrompt,
  type RuntimeAgentLiveE2EChatScenario,
} from './runtime-agent-live-e2e-fixture-realm-scenarios.test-helper';

export interface RuntimeAgentLiveE2ERealmFixtureContext {
  readonly baseUrl: string;
  readonly requests: RuntimeAgentLiveE2ERealmRequest[];
  readonly currentRuntimeAccountSession: () => {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly sessionId: string;
  };
}

type RuntimeAccountFixtureState = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  sequence: number;
};

export async function withRealmFixtureServer(
  input: {
    readonly localChatCompletionStreamDelayMs?: number;
    readonly voiceSpeechStreamDelayMs?: number;
    readonly run: (context: RuntimeAgentLiveE2ERealmFixtureContext) => Promise<void>;
  } | ((context: RuntimeAgentLiveE2ERealmFixtureContext) => Promise<void>),
): Promise<void> {
  const requests: RuntimeAgentLiveE2ERealmRequest[] = [];
  const accountState: RuntimeAccountFixtureState = {
    accessToken: RUNTIME_ACCOUNT_ACCESS_TOKEN,
    refreshToken: RUNTIME_ACCOUNT_REFRESH_TOKEN,
    sessionId: RUNTIME_ACCOUNT_SESSION_ID,
    sequence: 0,
  };
  const run = typeof input === 'function' ? input : input.run;
  const options = {
    localChatCompletionStreamDelayMs: typeof input === 'function'
      ? 0
      : Math.max(0, Math.trunc(Number(input.localChatCompletionStreamDelayMs || 0))),
    voiceSpeechStreamDelayMs: typeof input === 'function'
      ? 35
      : Math.max(0, Math.trunc(Number(input.voiceSpeechStreamDelayMs ?? 35))),
  };
  const server = createServer(async (request, response) => {
    try {
      await handleRealmFixtureRequest(request, response, requests, options, accountState);
    } catch (error) {
      writeJSON(response, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Realm fixture server did not expose a TCP address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({
      baseUrl,
      requests,
      currentRuntimeAccountSession: () => ({
        accessToken: accountState.accessToken,
        refreshToken: accountState.refreshToken,
        sessionId: accountState.sessionId,
      }),
    });
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  }).catch(() => {});
}

async function handleRealmFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RuntimeAgentLiveE2ERealmRequest[],
  options: {
    readonly localChatCompletionStreamDelayMs: number;
    readonly voiceSpeechStreamDelayMs: number;
  },
  accountState: RuntimeAccountFixtureState,
): Promise<void> {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const rawBody = await readRequestBody(request);
  const body = parseJSONBody(rawBody);
  const requestRecord: RuntimeAgentLiveE2ERealmRequest = {
    method: request.method || '',
    path: url.pathname,
    query: url.search.slice(1),
    authorization: String(request.headers.authorization || ''),
    body,
  };
  requests.push(requestRecord);

  if (request.method === 'GET' && url.pathname === '/api/auth/jwks') {
    writeJSON(response, 200, RUNTIME_AUTH_JWKS);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/jwks/source-materialization') {
    writeJSON(response, 200, FIXTURE_SOURCE_MATERIALIZATION_JWKS);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/sessions/introspect') {
    const sessionId = normalizeText(asRecord(body).session_id);
    const active = sessionId === accountState.sessionId;
    writeJSON(response, 200, { active, revoked: !active });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/oauth/token') {
    if (String(request.headers['content-type'] || '').startsWith('application/json')) {
      if (normalizeText(asRecord(body).refreshToken) !== accountState.refreshToken) {
        writeJSON(response, 400, { message: 'invalid Runtime OAuth refresh token' });
        return;
      }
      rotateRuntimeAccountSession(accountState);
      writeJSON(response, 200, runtimeTokenResponse(accountState));
      return;
    }
    const form = new URLSearchParams(rawBody);
    if (
      form.get('grant_type') !== 'authorization_code'
      || form.get('client_id') !== 'nimi-desktop'
      || !form.get('code_verifier')
      || form.get('redirect_uri') !== RUNTIME_ACCOUNT_REDIRECT_URI
    ) {
      writeJSON(response, 400, { message: 'invalid Runtime OAuth token exchange' });
      return;
    }
    writeJSON(response, 200, runtimeTokenResponse(accountState));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/refresh') {
    rotateRuntimeAccountSession(accountState);
    writeJSON(response, 200, runtimeTokenResponse(accountState));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/models') {
    writeJSON(response, 200, {
      data: [{
        id: LOCAL_TEXT_MODEL_ID,
      }, {
        id: LOCAL_EMBED_MODEL_ID,
      }, {
        id: FIXTURE_IMAGE_MODEL_ID,
      }, {
        id: FIXTURE_TRANSCRIPTION_MODEL_ID,
      }, {
        id: FIXTURE_VOICE_MODEL_ID,
      }],
    });
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/v1/healthz')) {
    writeJSON(response, 200, {
      ready: true,
      fixture: 'sdk-runtime-agent-live-e2e',
    });
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/catalog' || url.pathname === '/v1/catalog')) {
    writeJSON(response, 200, {
      models: [{
        id: FIXTURE_IMAGE_MODEL_ID,
        model_id: FIXTURE_IMAGE_MODEL_ID,
        provider: FIXTURE_IMAGE_PROVIDER,
        model_type: 'image',
        updated_at: '2026-07-02',
        capabilities: ['image.generate'],
        pricing: {
          unit: 'request',
          input: '0',
          output: '0',
          currency: 'USD',
          as_of: '2026-07-02',
          notes: 'Runtime Agent live fixture catalog entry.',
        },
        source_ref: {
          url: 'http://127.0.0.1/runtime-agent-live-e2e/catalog',
          retrieved_at: '2026-07-02',
          note: 'Runtime Agent live fixture catalog entry.',
        },
        image_request_options: {
          response_formats: ['b64_json', 'url'],
          max_images_per_request: 1,
          supports_negative_prompt: true,
          supports_reference_images: true,
          supports_mask: true,
          supports_seed: true,
          supports_size: true,
          supports_aspect_ratio: true,
          supports_quality: true,
          supports_style: true,
        },
      }, {
        id: FIXTURE_TRANSCRIPTION_MODEL_ID,
        model_id: FIXTURE_TRANSCRIPTION_MODEL_ID,
        provider: FIXTURE_IMAGE_PROVIDER,
        model_type: 'stt',
        updated_at: '2026-07-02',
        capabilities: ['audio.transcribe'],
        pricing: {
          unit: 'request',
          input: '0',
          output: '0',
          currency: 'USD',
          as_of: '2026-07-02',
          notes: 'Runtime Agent live fixture transcription catalog entry.',
        },
        source_ref: {
          url: 'http://127.0.0.1/runtime-agent-live-e2e/transcription-catalog',
          retrieved_at: '2026-07-02',
          note: 'Runtime Agent live fixture transcription catalog entry.',
        },
        transcription: {
          tiers: ['core_transcript'],
          response_formats: ['json'],
          supports_language: true,
          supports_prompt: true,
        },
      }],
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    await writeLocalChatCompletion(response, asRecord(body), options, requestRecord);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/embeddings') {
    writeLocalEmbedding(response, asRecord(body));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
    writeOpenAIImageGeneration(response, asRecord(body));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/services/audio/tts/customization') {
    writeDashScopeVoiceCustomization(response, asRecord(body));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/services/aigc/multimodal-generation/generation') {
    writeDashScopeNativeTTS(response, asRecord(body));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/audio/speech') {
    await writeOpenAISpeech(response, asRecord(body), options);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
    writeOpenAITranscription(response, rawBody);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/world') {
    if (String(request.headers.authorization || '') !== `Bearer ${RUNTIME_ACCOUNT_ACCESS_TOKEN}`) {
      writeJSON(response, 401, { message: 'Runtime Realm mediation token missing' });
      return;
    }
    writeJSON(response, 200, []);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/realm/core/source-materialization-packets') {
    if (String(request.headers.authorization || '') !== `Bearer ${RUNTIME_ACCOUNT_ACCESS_TOKEN}`) {
      writeJSON(response, 401, { message: 'Runtime Realm mediation token missing' });
      return;
    }
    const bodyRecord = asRecord(body);
    writeJSON(
      response,
      200,
      createFixtureSourceMaterializationPacket(bodyRecord as never),
    );
    return;
  }

  writeJSON(response, 404, { message: `unhandled Realm fixture route ${request.method || ''} ${url.pathname}` });
}

async function writeLocalChatCompletion(
  response: ServerResponse,
  body: Record<string, unknown>,
  options: {
    readonly localChatCompletionStreamDelayMs: number;
  },
  requestRecord?: RuntimeAgentLiveE2ERealmRequest,
): Promise<void> {
  const scenario = chatScenarioFromBody(body);
  if (requestRecord) {
    requestRecord.fixtureScenarioApml = scenario.apml;
  }
  if (scenario.failMode === 'chat-completion-500') {
    writeJSON(response, 500, {
      error: {
        code: 'ZHIYU_FIXTURE_CHAT_SCENARIO_FAILED',
        message: 'Runtime Agent live fixture scenario requested chat failure.',
      },
    });
    return;
  }
  const content = scenario.apml;
  const usage = scenario.usage ?? {
    promptTokens: 5,
    completionTokens: 7,
    totalTokens: 12,
  };
  if (body.stream === true) {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream');
    response.setHeader('cache-control', 'no-cache');
    for (const chunk of scenario.reasoningChunks ?? []) {
      response.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            reasoning_content: chunk,
          },
          finish_reason: null,
        }],
      })}\n\n`);
    }
    for (const chunk of chunksForScenario(scenario)) {
      response.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            content: chunk,
          },
          finish_reason: null,
        }],
      })}\n\n`);
    }
    if (options.localChatCompletionStreamDelayMs > 0) {
      await delay(options.localChatCompletionStreamDelayMs);
      if (response.destroyed || response.writableEnded) {
        return;
      }
    }
    response.write(`data: ${JSON.stringify({
      choices: [{
        delta: {},
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
      },
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
    return;
  }
  writeJSON(response, 200, {
    choices: [{
      finish_reason: 'stop',
      message: {
        content,
      },
    }],
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    },
  });
}

function chatScenarioFromBody(body: Record<string, unknown>): RuntimeAgentLiveE2EChatScenario {
  const promptText = promptTextFromChatCompletionBody(body);
  if (promptText.includes('runtime-private chat track sidecar executor')) {
    return {
      apml: '<chat-track-sidecar><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>',
    };
  }
  const explicitKey = scenarioKeyFromPrompt(promptText);
  if (explicitKey) {
    const scenario = RUNTIME_AGENT_LIVE_E2E_CHAT_SCENARIOS[explicitKey];
    if (!scenario) {
      return {
        apml: `<message id="message-unknown-scenario">Unknown Runtime Agent live fixture scenario ${escapeAPMLText(explicitKey)}.</message>`,
      };
    }
    return scenario;
  }
  return RUNTIME_AGENT_LIVE_E2E_CHAT_SCENARIOS.default;
}

function scenarioKeyFromPrompt(promptText: string): string {
  const matches = [...promptText.matchAll(/\[\[scenario:([a-z0-9][a-z0-9._:-]*)\]\]/gu)];
  return matches.at(-1)?.[1] ?? '';
}

function chunksForScenario(scenario: RuntimeAgentLiveE2EChatScenario): readonly string[] {
  const plan = scenario.chunks;
  if (Array.isArray(plan)) {
    return plan.length > 0 ? plan : [scenario.apml];
  }
  const splitMatch = typeof plan === 'string' ? plan.match(/^char-split-([1-9][0-9]*)$/u) : null;
  if (!splitMatch) {
    return [scenario.apml];
  }
  const size = Number(splitMatch[1]);
  const chunks: string[] = [];
  for (let index = 0; index < scenario.apml.length; index += size) {
    chunks.push(scenario.apml.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [scenario.apml];
}

function escapeAPMLText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

function promptTextFromChatCompletionBody(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const messageText = messages
    .map((message) => {
      const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
      const fragments = [
        ...textFragments(record.content),
        ...textFragments(record.parts),
        ...textFragments(record.text),
        ...textFragments(record.message),
      ];
      return (fragments.length > 0 ? fragments : textFragments(record)).join('\n');
    })
    .join('\n');
  return [
    messageText,
    ...textFragments(body.input),
    ...textFragments(body.prompt),
  ]
    .join('\n')
    .toLowerCase();
}

function textFragments(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = normalizeText(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => textFragments(item));
  }
  if (typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  const fragments = [
    ...textFragments(record.text),
    ...textFragments(record.content),
    ...textFragments(record.input),
    ...textFragments(record.value),
    ...textFragments(record.message),
    ...textFragments(record.parts),
    ...textFragments(record.data),
  ];
  if (fragments.length > 0) {
    return fragments;
  }
  try {
    return [JSON.stringify(record)];
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function writeOpenAIImageGeneration(response: ServerResponse, body: Record<string, unknown>): void {
  const prompt = normalizeText(body.prompt);
  if (prompt.toLowerCase().includes('zhiyu induced action failure')) {
    writeJSON(response, 500, {
      error: {
        code: 'ZHIYU_FIXTURE_INDUCED_IMAGE_ACTION_FAILURE',
        message: 'Zhiyu live fixture induced image action failure after committed text.',
      },
    });
    return;
  }
  writeJSON(response, 200, {
    data: [{
      b64_json: LOCAL_IMAGE_PNG_BASE64,
    }],
    usage: {
      prompt_tokens: Math.max(1, prompt.split(/\s+/u).filter(Boolean).length),
      completion_tokens: 1,
      total_tokens: 2,
    },
  });
}

function writeOpenAITranscription(response: ServerResponse, rawBody: string): void {
  if (!rawBody.includes(FIXTURE_TRANSCRIPTION_MODEL_ID)) {
    writeJSON(response, 400, {
      error: {
        code: 'ZHIYU_FIXTURE_TRANSCRIPTION_ROUTE_MISMATCH',
        message: 'Unexpected transcription route model.',
      },
    });
    return;
  }
  writeJSON(response, 200, {
    text: 'Runtime live fixture transcript.',
    usage: {
      prompt_tokens: Math.max(1, Math.floor(rawBody.length / 256)),
      completion_tokens: 4,
      total_tokens: Math.max(5, Math.floor(rawBody.length / 256) + 4),
    },
  });
}

function writeDashScopeVoiceCustomization(response: ServerResponse, body: Record<string, unknown>): void {
  const model = normalizeText(body.model);
  const input = asRecord(body.input);
  const targetModel = normalizeText(input.target_model);
  const action = normalizeText(input.action);
  if (model !== 'runtime-live-voice-clone' || targetModel !== FIXTURE_VOICE_MODEL_ID || action !== 'create') {
    writeJSON(response, 400, {
      error: {
        code: 'ZHIYU_FIXTURE_VOICE_WORKFLOW_MISMATCH',
        message: `Unexpected voice workflow model=${model} target=${targetModel} action=${action}`,
      },
    });
    return;
  }
  writeJSON(response, 200, {
    output: {
      voice: FIXTURE_VOICE_ID,
    },
  });
}

async function writeOpenAISpeech(
  response: ServerResponse,
  body: Record<string, unknown>,
  options: {
    readonly voiceSpeechStreamDelayMs: number;
  },
): Promise<void> {
  const model = normalizeText(body.model);
  const voice = normalizeText(body.voice);
  if (model !== FIXTURE_VOICE_MODEL_ID || voice !== FIXTURE_VOICE_ID) {
    writeJSON(response, 400, {
      error: {
        code: 'ZHIYU_FIXTURE_VOICE_ROUTE_MISMATCH',
        message: `Unexpected voice route model=${model} voice=${voice}`,
      },
    });
    return;
  }

  const audio = body.stream === true ? createFixtureWavBuffer({ seconds: 3 }) : createFixtureWavBuffer();
  response.statusCode = 200;
  response.setHeader('content-type', 'audio/wav');
  if (body.stream === true) {
    response.setHeader('cache-control', 'no-cache');
    response.flushHeaders?.();
    // Keep the first frame larger than Runtime's provider read buffer so the
    // loopback HTTP fixture proves a provider-readable non-final frame before
    // completion instead of relying on transport-specific small-write flushes.
    const firstChunkSize = Math.min(64 * 1024, audio.byteLength);
    response.write(audio.subarray(0, firstChunkSize));
    (response as ServerResponse & { flush?: () => void }).flush?.();
    await new Promise((resolve) => setImmediate(resolve));
    await delay(options.voiceSpeechStreamDelayMs);
    if (response.destroyed || response.writableEnded) {
      return;
    }
    if (normalizeText(body.input).toLowerCase().includes('zhiyu induced native voice failure')) {
      response.destroy(new Error('Zhiyu fixture induced native voice stream failure'));
      return;
    }
    response.end(audio.subarray(firstChunkSize));
    return;
  }
  response.setHeader('content-length', String(audio.byteLength));
  response.end(audio);
}

function writeDashScopeNativeTTS(
  response: ServerResponse,
  body: Record<string, unknown>,
): void {
  const input = asRecord(body.input);
  const model = normalizeText(body.model);
  const voice = normalizeText(input.voice);
  if (model !== FIXTURE_VOICE_MODEL_ID || voice !== FIXTURE_VOICE_ID) {
    writeJSON(response, 400, {
      error: {
        code: 'ZHIYU_FIXTURE_DASHSCOPE_NATIVE_TTS_ROUTE_MISMATCH',
        message: `Unexpected DashScope native TTS model=${model} voice=${voice}`,
      },
    });
    return;
  }

  const audio = createFixtureWavBuffer();
  response.statusCode = 200;
  response.setHeader('content-type', 'audio/wav');
  response.setHeader('content-length', String(audio.byteLength));
  response.end(audio);
}

function createFixtureWavBuffer(options: { readonly seconds?: number } = {}): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const seconds = Math.max(1, Math.floor(options.seconds ?? 1));
  const samples = sampleRate * seconds;
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function writeLocalEmbedding(response: ServerResponse, body: Record<string, unknown>): void {
  const input = body.input;
  const values = Array.isArray(input) ? input : [input];
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const data = normalized.map((value, index) => ({
    object: 'embedding',
    index,
    embedding: embeddingVectorForText(value),
  }));
  writeJSON(response, 200, {
    object: 'list',
    data,
    model: LOCAL_EMBED_MODEL_ID,
    usage: {
      prompt_tokens: Math.max(1, normalized.join(' ').split(/\s+/u).filter(Boolean).length),
      total_tokens: Math.max(1, normalized.length * LOCAL_EMBED_DIMENSIONS),
    },
  });
}

function embeddingVectorForText(value: string): number[] {
  const digest = createHash('sha256').update(value || 'runtime-agent-live-e2e').digest();
  const out: number[] = [];
  for (let index = 0; index < LOCAL_EMBED_DIMENSIONS; index += 1) {
    out.push(Number(((digest[index] ?? 0) / 255).toFixed(6)));
  }
  return out;
}

function rotateRuntimeAccountSession(state: RuntimeAccountFixtureState): void {
  state.sequence += 1;
  state.sessionId = `${RUNTIME_ACCOUNT_SESSION_ID}-refresh-${state.sequence}`;
  state.accessToken = createRuntimeAccountAccessToken(state.sessionId);
  state.refreshToken = `${RUNTIME_ACCOUNT_REFRESH_TOKEN}-refresh-${state.sequence}`;
}

function runtimeTokenResponse(state: RuntimeAccountFixtureState): JsonObject {
  return {
    access_token: state.accessToken,
    refresh_token: state.refreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
    account_id: OWNER_USER_ID,
    display_name: 'Runtime Live User',
    realm_environment_id: 'realm-runtime-live',
    workspace_memberships: [],
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJSONBody(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.includes('=') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return Object.fromEntries(new URLSearchParams(trimmed));
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return {};
  }
}

function writeJSON(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
