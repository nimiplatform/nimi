/**
 * Bytedance TTS Tutorial (single-file runtime client, no provider wrapper)
 *
 * Flow:
 * 1) save api key -> connectorId
 * 2) synthesize with connectorId
 * 3) app layer resolves connectorId -> key, runtime only receives request metadata
 *
 * Required env:
 * - NIMI_BYTEDANCE_API_KEY=xxx
 *
 * Optional env:
 * - NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 * - NIMI_APP_ID=example.providers.bytedance.tts
 * - NIMI_SUBJECT_USER_ID=local-user
 * - NIMI_BYTEDANCE_ENDPOINT=https://your-openspeech-endpoint
 * - NIMI_BYTEDANCE_TTS_MODEL=volcengine/voice-1
 * - NIMI_BYTEDANCE_TTS_VOICE=zh_female
 * - NIMI_BYTEDANCE_TTS_TEXT="Hello from ByteDance OpenSpeech via nimi runtime."
 * - NIMI_BYTEDANCE_TTS_OUT=./tmp/bytedance-tts.mp3
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Runtime } from '@nimiplatform/sdk';

type SavedConnector = {
  connectorId: string;
  provider: 'bytedance';
  endpoint: string;
  apiKey: string;
};

const connectorStore = new Map<string, SavedConnector>();

function env(name: string, fallback = ''): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function saveConnector(input: { endpoint: string; apiKey: string }): string {
  const connectorId = `connector_${randomUUID()}`;
  connectorStore.set(connectorId, {
    connectorId,
    provider: 'bytedance',
    endpoint: String(input.endpoint || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
  });
  return connectorId;
}

function resolveConnector(connectorId: string): SavedConnector {
  const connector = connectorStore.get(connectorId);
  if (!connector) {
    throw new Error(`connector not found: ${connectorId}`);
  }
  if (!connector.apiKey) {
    throw new Error(`connector api key missing: ${connectorId}`);
  }
  return connector;
}

async function saveBytes(outPath: string, bytes: Uint8Array): Promise<string> {
  const abs = resolve(outPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  return abs;
}

async function main(): Promise<void> {
  const endpoint = env('NIMI_RUNTIME_GRPC_ENDPOINT', '127.0.0.1:46371');
  const appId = env('NIMI_APP_ID', 'example.providers.bytedance.tts');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const model = env('NIMI_BYTEDANCE_TTS_MODEL', 'volcengine/voice-1');
  const voice = env('NIMI_BYTEDANCE_TTS_VOICE', 'zh_female');
  const text = env('NIMI_BYTEDANCE_TTS_TEXT', 'Hello from ByteDance OpenSpeech via nimi runtime.');
  const out = env('NIMI_BYTEDANCE_TTS_OUT', './tmp/bytedance-tts.mp3');

  const connectorId = saveConnector({
    endpoint: env('NIMI_BYTEDANCE_ENDPOINT', ''),
    apiKey: requiredEnv('NIMI_BYTEDANCE_API_KEY'),
  });

  const runtime = new Runtime({
    appId,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'docs-example-provider',
    },
  });

  const connector = resolveConnector(connectorId);
  const response = await runtime.media.tts.synthesize({
    model,
    subjectUserId,
    connectorId,
    text,
    voice,
    audioFormat: 'mp3',
    route: 'token-api',
    fallback: 'deny',
    timeoutMs: 120000,
    metadata: {
      keySource: 'inline',
      providerEndpoint: connector.endpoint,
      providerApiKey: connector.apiKey,
    },
  });

  const first = response.artifacts[0];
  if (!first?.bytes) {
    throw new Error('tts returned empty artifacts');
  }
  const output = await saveBytes(out, first.bytes);

  log(`[bytedance-tts] runtime grpc endpoint: ${endpoint}`);
  log(`[bytedance-tts] connectorId: ${connectorId}`);
  log(`[bytedance-tts] model: ${model}`);
  log(`[bytedance-tts] jobId: ${response.job.jobId}`);
  log(`[bytedance-tts][saved] ${output}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[example-error] ${message}\n`);
  process.exitCode = 1;
}
