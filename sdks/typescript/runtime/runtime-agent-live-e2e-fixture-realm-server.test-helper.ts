import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { JsonObject } from '../types';
import { createFixtureSourceMaterializationPacket } from './runtime-agent-live-e2e-fixture-source-packet.test-helper';
import {
  FIXTURE_IMAGE_MODEL_ID,
  FIXTURE_IMAGE_PROVIDER,
  LOCAL_EMBED_DIMENSIONS,
  LOCAL_EMBED_MODEL_ID,
  LOCAL_IMAGE_PNG_BASE64,
  LOCAL_TEXT_MODEL_ID,
  OWNER_USER_ID,
  RUNTIME_ACCOUNT_ACCESS_TOKEN,
  RUNTIME_ACCOUNT_REDIRECT_URI,
  RUNTIME_ACCOUNT_REFRESH_TOKEN,
  SOURCE_MATERIALIZATION_AUDIENCE,
  type RuntimeAgentLiveE2ERealmRequest,
  normalizeText,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

export async function withRealmFixtureServer(
  run: (context: {
    readonly baseUrl: string;
    readonly requests: RuntimeAgentLiveE2ERealmRequest[];
  }) => Promise<void>,
): Promise<void> {
  const requests: RuntimeAgentLiveE2ERealmRequest[] = [];
  const server = createServer(async (request, response) => {
    try {
      await handleRealmFixtureRequest(request, response, requests);
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
    await run({ baseUrl, requests });
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
): Promise<void> {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const rawBody = await readRequestBody(request);
  const body = parseJSONBody(rawBody);
  requests.push({
    method: request.method || '',
    path: url.pathname,
    query: url.search.slice(1),
    authorization: String(request.headers.authorization || ''),
    body,
  });

  if (request.method === 'POST' && url.pathname === '/api/auth/oauth/token') {
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
    writeJSON(response, 200, runtimeTokenResponse());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/refresh') {
    writeJSON(response, 200, runtimeTokenResponse());
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
      }],
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    writeLocalChatCompletion(response, asRecord(body));
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

  if (request.method === 'POST' && url.pathname === '/api/realm/core/source-materialization-packets') {
    if (String(request.headers.authorization || '') !== `Bearer ${RUNTIME_ACCOUNT_ACCESS_TOKEN}`) {
      writeJSON(response, 401, { message: 'Runtime Realm mediation token missing' });
      return;
    }
    const bodyRecord = asRecord(body);
    const sourceRef = asRecord(bodyRecord.sourceRef);
    const intendedRuntimeAudience = normalizeText(bodyRecord.intendedRuntimeAudience);
    if (intendedRuntimeAudience !== SOURCE_MATERIALIZATION_AUDIENCE) {
      writeJSON(response, 400, { message: 'unexpected source materialization audience' });
      return;
    }
    writeJSON(response, 200, createFixtureSourceMaterializationPacket(sourceRef, intendedRuntimeAudience));
    return;
  }

  writeJSON(response, 404, { message: `unhandled Realm fixture route ${request.method || ''} ${url.pathname}` });
}

function writeLocalChatCompletion(response: ServerResponse, body: Record<string, unknown>): void {
  const content = '<message id="message-0">Hello from the Runtime Agent live fixture.</message>';
  if (body.stream === true) {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream');
    response.setHeader('cache-control', 'no-cache');
    response.write(`data: ${JSON.stringify({
      choices: [{
        delta: {
          content,
        },
        finish_reason: null,
      }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      choices: [{
        delta: {},
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 7,
        total_tokens: 12,
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
      prompt_tokens: 5,
      completion_tokens: 7,
      total_tokens: 12,
    },
  });
}

function writeOpenAIImageGeneration(response: ServerResponse, body: Record<string, unknown>): void {
  const prompt = normalizeText(body.prompt);
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

function runtimeTokenResponse(): JsonObject {
  return {
    access_token: RUNTIME_ACCOUNT_ACCESS_TOKEN,
    refresh_token: RUNTIME_ACCOUNT_REFRESH_TOKEN,
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
