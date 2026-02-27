/**
 * Bytedance TTS Tutorial (single-file, no wrapper)
 *
 * Flow:
 * 1) save api key -> connectorId
 * 2) synthesize with connectorId
 * 3) connectorId resolved in app layer, runtime consumes request metadata only
 *
 * Required env:
 * - NIMI_BYTEDANCE_API_KEY=xxx
 *
 * Optional env:
 * - NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 * - NIMI_APP_ID=example.providers.bytedance.tts
 * - NIMI_SUBJECT_USER_ID=local-user
 * - NIMI_BYTEDANCE_ENDPOINT=https://your-openspeech-endpoint
 * - NIMI_BYTEDANCE_TTS_MODEL=bytedance/tts-1
 * - NIMI_BYTEDANCE_TTS_TEXT="Hello from ByteDance OpenSpeech via nimi runtime."
 * - NIMI_BYTEDANCE_TTS_OUT=./tmp/bytedance-tts.mp3
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Runtime } from '@nimiplatform/sdk';

const MODAL_TTS = 4;
const ROUTE_POLICY_TOKEN_API = 2;
const FALLBACK_POLICY_DENY = 1;
const MEDIA_JOB_STATUS_COMPLETED = 4;
const MEDIA_JOB_STATUS_FAILED = 5;
const MEDIA_JOB_STATUS_CANCELED = 6;
const MEDIA_JOB_STATUS_TIMEOUT = 7;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}

async function main(): Promise<void> {
  const endpoint = env('NIMI_RUNTIME_GRPC_ENDPOINT', '127.0.0.1:46371');
  const appId = env('NIMI_APP_ID', 'example.providers.bytedance.tts');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const model = env('NIMI_BYTEDANCE_TTS_MODEL', 'bytedance/tts-1');
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
  const submitted = await runtime.ai.submitMediaJob({
    appId,
    subjectUserId,
    modelId: model,
    modal: MODAL_TTS,
    routePolicy: ROUTE_POLICY_TOKEN_API,
    fallback: FALLBACK_POLICY_DENY,
    timeoutMs: 120000,
    requestId: '',
    idempotencyKey: '',
    labels: {},
    spec: {
      oneofKind: 'speechSpec',
      speechSpec: {
        text,
        voice: '',
        language: '',
        audioFormat: 'mp3',
        sampleRateHz: 0,
        speed: 0,
        pitch: 0,
        volume: 0,
        emotion: '',
      },
    },
  }, {
    metadata: {
      credentialSource: 'request-injected',
      providerEndpoint: connector.endpoint,
      providerApiKey: connector.apiKey,
    } as any,
  });

  const jobId = String(submitted.job?.jobId || '').trim();
  if (!jobId) {
    throw new Error('submitMediaJob did not return jobId');
  }

  for (;;) {
    const jobResp = await runtime.ai.getMediaJob({ jobId });
    const status = Number(jobResp.job?.status || 0);
    if (status === MEDIA_JOB_STATUS_COMPLETED) {
      break;
    }
    if (
      status === MEDIA_JOB_STATUS_FAILED
      || status === MEDIA_JOB_STATUS_CANCELED
      || status === MEDIA_JOB_STATUS_TIMEOUT
    ) {
      const detail = String(jobResp.job?.reasonDetail || '').trim();
      throw new Error(`tts job failed: status=${status}${detail ? ` detail=${detail}` : ''}`);
    }
    await sleep(300);
  }

  const artifacts = await runtime.ai.getMediaArtifacts({ jobId });
  const first = artifacts.artifacts[0];
  if (!first) {
    throw new Error('tts returned empty artifacts');
  }
  const output = await saveBytes(out, first.bytes);

  log(`[bytedance-tts] runtime grpc endpoint: ${endpoint}`);
  log(`[bytedance-tts] connectorId: ${connectorId}`);
  log(`[bytedance-tts] model: ${model}`);
  log(`[bytedance-tts][saved] ${output}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[example-error] ${message}\n`);
  process.exitCode = 1;
}
