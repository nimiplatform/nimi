import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ExecutionMode,
  FallbackPolicy,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
  type ScenarioSpec,
} from './generated';
import { Runtime } from './index';
import { withRuntimeDaemon } from './live-runtime-daemon.test-helper';
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
} from '../core/ai';
import {
  createNimiImageGenerationScenario,
  createNimiRuntimeGenerationClient,
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
  createNimiVideoGenerationScenario,
} from '../features/generation';
import {
  loadSourceProviderCapabilityMatrix,
} from '../../../scripts/live-provider-utils.mjs';

type ProviderCapability =
  | 'generate'
  | 'embed'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'music'
  | 'voice_clone'
  | 'voice_design';

const APP_ID = 'nimi.desktop.sdk.vnext.live';
const SUBJECT_USER_ID = 'user-sdk-vnext-live';
const LIVE_VOICE_DESIGN_INSTRUCTION = 'Warm, calm, natural narrator voice with steady pacing, clear diction, low background noise, gentle emotional range, and a polished studio delivery for long-form spoken content.';
const LIVE_VOICE_CLONE_TEXT = 'Hello from Nimi SDK vNext live voice clone.';

function providerEnvToken(provider: string): string {
  return String(provider || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function envValue(keys: readonly string[]): string {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function requiredAnyEnvOrSkip(t: { skip: (message?: string) => void }, keys: readonly string[]): string | null {
  const value = envValue(keys);
  if (!value) {
    t.skip(`set one of ${keys.join(', ')} to run live smoke test`);
    return null;
  }
  return value;
}

function loadProviderCapabilityMatrix(): Map<string, Set<ProviderCapability>> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return loadSourceProviderCapabilityMatrix(
    resolve(repoRoot, 'runtime', 'catalog', 'source', 'providers'),
  ) as Map<string, Set<ProviderCapability>>;
}

function normalizeCloudModelId(modelId: string): string {
  const normalized = String(modelId || '').trim();
  if (!normalized) return normalized;
  if (normalized.toLowerCase().startsWith('cloud/') || normalized.includes('/')) {
    return normalized;
  }
  return `cloud/${normalized}`;
}

function sdkRoutePolicy(provider: string): 'local' | 'cloud' {
  return provider === 'local' ? 'local' : 'cloud';
}

function runtimeRoutePolicy(provider: string): RoutePolicy {
  return provider === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD;
}

function routedModelId(provider: string, modelId: string): string {
  return sdkRoutePolicy(provider) === 'cloud' ? normalizeCloudModelId(modelId) : modelId;
}

function createRuntimeModule(endpoint: string): Runtime {
  return new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  });
}

function buildRuntimeEnvForProvider(t: { skip: (message?: string) => void }, provider: string): Record<string, string> | null {
  const token = providerEnvToken(provider);
  if (provider === 'local') {
    const baseUrl = envValue(['NIMI_LIVE_LOCAL_BASE_URL']);
    const speechBaseUrl = envValue(['NIMI_LIVE_LOCAL_SPEECH_BASE_URL']);
    const sidecarBaseUrl = envValue(['NIMI_LIVE_LOCAL_SIDECAR_BASE_URL']);
    const localModelsPath = envValue(['NIMI_LIVE_LOCAL_MODELS_PATH']) || resolve(homedir(), '.nimi', 'data', 'models');
    if (!baseUrl && !speechBaseUrl && !sidecarBaseUrl) {
      t.skip('set NIMI_LIVE_LOCAL_BASE_URL or NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_SIDECAR_BASE_URL to run local SDK vNext live smoke');
      return null;
    }
    return {
      ...(baseUrl ? { NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: baseUrl } : {}),
      ...(envValue(['NIMI_LIVE_LOCAL_API_KEY']) ? { NIMI_RUNTIME_LOCAL_LLAMA_API_KEY: envValue(['NIMI_LIVE_LOCAL_API_KEY']) } : {}),
      ...(speechBaseUrl ? { NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL: speechBaseUrl } : {}),
      ...(envValue(['NIMI_LIVE_LOCAL_SPEECH_API_KEY']) ? { NIMI_RUNTIME_LOCAL_SPEECH_API_KEY: envValue(['NIMI_LIVE_LOCAL_SPEECH_API_KEY']) } : {}),
      ...(sidecarBaseUrl ? { NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL: sidecarBaseUrl } : {}),
      ...(envValue(['NIMI_LIVE_LOCAL_SIDECAR_API_KEY']) ? { NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY: envValue(['NIMI_LIVE_LOCAL_SIDECAR_API_KEY']) } : {}),
      ...(localModelsPath ? { NIMI_RUNTIME_LOCAL_MODELS_PATH: localModelsPath } : {}),
    };
  }

  const apiKey = requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_API_KEY`]);
  if (!apiKey) return null;
  const baseUrl = envValue([`NIMI_LIVE_${token}_BASE_URL`]);
  return {
    ...(baseUrl ? { [`NIMI_RUNTIME_CLOUD_${token}_BASE_URL`]: baseUrl } : {}),
    [`NIMI_RUNTIME_CLOUD_${token}_API_KEY`]: apiKey,
    ...(provider === 'mubert' && envValue(['NIMI_LIVE_MUBERT_CUSTOMER_ID'])
      ? { NIMI_RUNTIME_CLOUD_MUBERT_CUSTOMER_ID: envValue(['NIMI_LIVE_MUBERT_CUSTOMER_ID']) }
      : {}),
    ...(provider === 'mubert' && envValue(['NIMI_LIVE_MUBERT_ACCESS_TOKEN'])
      ? { NIMI_RUNTIME_CLOUD_MUBERT_ACCESS_TOKEN: envValue(['NIMI_LIVE_MUBERT_ACCESS_TOKEN']) }
      : {}),
  };
}

function capabilityModelId(t: { skip: (message?: string) => void }, provider: string, capability: ProviderCapability): string | null {
  const token = providerEnvToken(provider);
  switch (capability) {
    case 'generate':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_MODEL_ID`]);
    case 'embed':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_EMBED_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'image':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_IMAGE_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'video':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_VIDEO_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'tts':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_TTS_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'stt':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_STT_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'music':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_MUSIC_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'voice_clone':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_VOICE_CLONE_MODEL_ID`, `NIMI_LIVE_${token}_TTS_MODEL_ID`]);
    case 'voice_design':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_VOICE_DESIGN_MODEL_ID`, `NIMI_LIVE_${token}_TTS_MODEL_ID`]);
    default:
      return null;
  }
}

function resolveLiveAudioMime(resource: string): string {
  const normalized = String(resource || '').trim().toLowerCase();
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.m4a')) return 'audio/mp4';
  if (normalized.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/wav';
}

function loadLiveAudioBytes(filePath: string): Uint8Array {
  const bytes = readFileSync(filePath);
  assert.ok(bytes.length > 0, `${filePath} should not be empty`);
  return new Uint8Array(bytes);
}

function resolveLiveSttAudioInput():
  | { readonly audio: { readonly kind: 'bytes'; readonly bytes: Uint8Array }; readonly mimeType: string }
  | { readonly audio: { readonly kind: 'url'; readonly url: string }; readonly mimeType: string }
  | null {
  const audioPath = envValue(['NIMI_LIVE_STT_AUDIO_PATH']);
  if (audioPath) {
    return {
      audio: { kind: 'bytes', bytes: loadLiveAudioBytes(audioPath) },
      mimeType: resolveLiveAudioMime(audioPath),
    };
  }
  const audioUri = envValue(['NIMI_LIVE_STT_AUDIO_URI']);
  if (!audioUri) return null;
  return {
    audio: { kind: 'url', url: audioUri },
    mimeType: resolveLiveAudioMime(audioUri),
  };
}

function resolveLiveVoiceCloneInput(provider: string):
  | {
    readonly referenceAudioBytes: Uint8Array;
    readonly referenceAudioUri: string;
    readonly referenceAudioMime: string;
    readonly languageHints: readonly string[];
    readonly preferredName: string;
    readonly text: string;
  }
  | null {
  const token = providerEnvToken(provider);
  const audioPath = envValue([
    `NIMI_LIVE_${token}_VOICE_REFERENCE_AUDIO_PATH`,
    'NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH',
  ]);
  const audioUri = envValue([
    `NIMI_LIVE_${token}_VOICE_REFERENCE_AUDIO_URI`,
    'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI',
  ]);
  const text = envValue([
    `NIMI_LIVE_${token}_VOICE_CLONE_TEXT`,
    'NIMI_LIVE_VOICE_CLONE_TEXT',
  ]) || LIVE_VOICE_CLONE_TEXT;

  if (audioPath) {
    return {
      referenceAudioBytes: loadLiveAudioBytes(audioPath),
      referenceAudioUri: '',
      referenceAudioMime: resolveLiveAudioMime(audioPath),
      languageHints: [],
      preferredName: 'Nimi SDK vNext voice clone smoke',
      text,
    };
  }
  if (!audioUri) return null;
  return {
    referenceAudioBytes: new Uint8Array(),
    referenceAudioUri: audioUri,
    referenceAudioMime: resolveLiveAudioMime(audioUri),
    languageHints: [],
    preferredName: 'Nimi SDK vNext voice clone smoke',
    text,
  };
}

function localManagedModelsRoot(): string {
  return envValue(['NIMI_LIVE_LOCAL_MODELS_PATH']) || resolve(homedir(), '.nimi', 'data', 'models');
}

function localManagedManifestPath(modelId: string): string {
  const normalized = String(modelId || '').trim().replace(/^local\//i, '');
  return resolve(localManagedModelsRoot(), 'resolved', normalized, 'asset.manifest.json');
}

async function importAndStartLocalManagedAsset(runtime: Runtime, modelId: string): Promise<void> {
  const manifestPath = localManagedManifestPath(modelId);
  const imported = await runtime.local.importLocalAsset({ manifestPath });
  const localAssetId = String(imported.asset?.localAssetId || '').trim();
  assert.ok(localAssetId, `local managed import should return localAssetId for ${modelId}`);
  await runtime.local.startLocalAsset({ localAssetId });
}

async function waitForScenarioJobDone(runtime: Runtime, jobId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await runtime.ai.getScenarioJob({ jobId });
    const job = response.job;
    const status = job?.status ?? ScenarioJobStatus.UNSPECIFIED;
    if (
      status === ScenarioJobStatus.COMPLETED
      || status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`scenario job timeout waiting terminal status: ${jobId}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}

function scenarioHead(provider: string, modelId: string, timeoutMs: number) {
  return {
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
    modelId: routedModelId(provider, modelId),
    routePolicy: runtimeRoutePolicy(provider),
    fallback: FallbackPolicy.DENY,
    timeoutMs,
    connectorId: provider === 'local' ? '' : provider,
  };
}

async function submitDirectScenario(
  runtime: Runtime,
  provider: string,
  modelId: string,
  scenarioType: ScenarioType,
  spec: ScenarioSpec,
  timeoutMs: number,
) {
  const response = await runtime.ai.submitScenarioJob({
    head: scenarioHead(provider, modelId, timeoutMs),
    scenarioType,
    executionMode: ExecutionMode.ASYNC_JOB,
    spec,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    labels: {},
    extensions: [],
  });
  const jobId = String(response.job?.jobId || '').trim();
  assert.ok(jobId, `scenario ${ScenarioType[scenarioType] || scenarioType} job id should not be empty`);
  return response;
}

async function runSdkVNextCapabilityLiveSmoke(endpoint: string, provider: string, capability: ProviderCapability, modelId: string): Promise<void> {
  const runtime = createRuntimeModule(endpoint);
  const route = sdkRoutePolicy(provider);
  const modelRef = {
    providerId: provider,
    modelId: routedModelId(provider, modelId),
  };

  if (provider === 'local') {
    await importAndStartLocalManagedAsset(runtime, modelRef.modelId);
  }

  if (capability === 'generate') {
    const model = createNimiRuntimeAIModel({
      runtime,
      model: modelRef,
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      routePolicy: route,
      connectorId: provider === 'local' ? '' : provider,
      timeoutMs: 45_000,
    });
    const result = await model.generateText({
      model: model.model,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Say hello from Nimi SDK vNext live smoke.' }],
      }],
    });
    assert.ok(result.text.trim().length > 0, 'generate output should not be empty');
    return;
  }

  if (capability === 'embed') {
    const embedding = createNimiRuntimeEmbeddingClient({
      runtime,
      model: modelRef,
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      routePolicy: route,
      connectorId: provider === 'local' ? '' : provider,
      timeoutMs: 45_000,
    });
    const result = await embedding.embedText({ values: ['Nimi SDK vNext matrix live smoke embed'] });
    assert.ok(result.embeddings.length > 0, 'embedding output should not be empty');
    return;
  }

  const generation = createNimiRuntimeGenerationClient({
    runtime,
    head: {
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      modelId: modelRef.modelId,
      routePolicy: route,
      connectorId: provider === 'local' ? '' : provider,
      timeoutMs: 240_000,
    },
  });

  if (capability === 'image') {
    const job = await generation.submit({
      scenario: createNimiImageGenerationScenario({
        kind: 'image',
        prompt: 'A minimal icon of a moon over the ocean.',
      }),
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    assert.ok(job.id, 'image job id should not be empty');
    return;
  }

  if (capability === 'video') {
    const job = await generation.submit({
      scenario: createNimiVideoGenerationScenario({
        kind: 'video',
        mode: 't2v',
        prompt: 'A short sunrise cinematic shot.',
        options: { durationSec: 4 },
      }),
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    assert.ok(job.id, 'video job id should not be empty');
    return;
  }

  if (capability === 'tts') {
    const job = await generation.submit({
      scenario: createNimiSpeechSynthesisScenario({
        kind: 'speech-synthesize',
        text: 'Nimi SDK vNext live smoke speech synthesis.',
      }),
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    assert.ok(job.id, 'tts job id should not be empty');
    return;
  }

  if (capability === 'stt') {
    const audioInput = resolveLiveSttAudioInput();
    if (!audioInput) {
      throw new Error('NIMI_LIVE_STT_AUDIO_PATH or NIMI_LIVE_STT_AUDIO_URI is required for stt live smoke');
    }
    const job = await generation.submit({
      scenario: createNimiSpeechTranscriptionScenario({
        kind: 'speech-transcribe',
        audio: audioInput.audio,
        mimeType: audioInput.mimeType,
      }),
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    assert.ok(job.id, 'stt job id should not be empty');
    return;
  }

  if (capability === 'music') {
    await submitDirectScenario(runtime, provider, modelId, ScenarioType.MUSIC_GENERATE, {
      spec: {
        oneofKind: 'musicGenerate',
        musicGenerate: {
          prompt: 'A short atmospheric cue for a product intro with warm synths and a gentle pulse.',
          negativePrompt: '',
          lyrics: '',
          style: '',
          title: 'Nimi SDK vNext Music Smoke',
          durationSeconds: 10,
          instrumental: true,
        },
      },
    }, 240_000);
    return;
  }

  const targetModelId = envValue([
    `NIMI_LIVE_${providerEnvToken(provider)}_${capability === 'voice_clone' ? 'VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID' : 'VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID'}`,
  ]) || modelId;
  const scenarioSpec: ScenarioSpec = capability === 'voice_clone'
    ? {
      spec: {
        oneofKind: 'voiceClone',
        voiceClone: {
          targetModelId,
          input: resolveLiveVoiceCloneInput(provider) ?? undefined,
        },
      },
    }
    : {
      spec: {
        oneofKind: 'voiceDesign',
        voiceDesign: {
          targetModelId,
          input: {
            instructionText: LIVE_VOICE_DESIGN_INSTRUCTION,
            previewText: LIVE_VOICE_CLONE_TEXT,
            language: '',
            preferredName: 'Nimi SDK vNext voice design smoke',
          },
        },
      },
    };
  if (capability === 'voice_clone' && !scenarioSpec.spec.voiceClone.input) {
    throw new Error('voice clone live smoke requires reference audio path or URI');
  }

  const response = await submitDirectScenario(
    runtime,
    provider,
    modelId,
    capability === 'voice_clone' ? ScenarioType.VOICE_CLONE : ScenarioType.VOICE_DESIGN,
    scenarioSpec,
    180_000,
  );
  const job = await waitForScenarioJobDone(runtime, response.job?.jobId || '', 180_000);
  assert.equal(
    job?.status,
    ScenarioJobStatus.COMPLETED,
    `voice workflow should complete: status=${job?.status} reasonCode=${job?.reasonCode} detail=${job?.reasonDetail || ''}`,
  );
  const voiceAssetId = String(response.asset?.voiceAssetId || '').trim();
  if (voiceAssetId) {
    const deleted = await runtime.ai.deleteVoiceAsset({ voiceAssetId });
    assert.equal(deleted.ack?.ok, true, `deleteVoiceAsset should acknowledge cleanup for ${voiceAssetId}`);
  }
}

function maybeProviderQuotaSkipMessage(provider: string, error: unknown): string {
  const normalized = error as {
    readonly message?: string;
    readonly reasonCode?: string;
    readonly actionHint?: string;
    readonly code?: string;
    readonly cause?: { readonly message?: string; readonly reasonCode?: string; readonly actionHint?: string; readonly code?: string };
  } | undefined;
  const message = [
    normalized?.message,
    normalized?.reasonCode,
    normalized?.actionHint,
    normalized?.code,
    normalized?.cause?.message,
    normalized?.cause?.reasonCode,
    normalized?.cause?.actionHint,
    normalized?.cause?.code,
    error instanceof Error ? error.message : '',
  ].filter(Boolean).join(' ').toLowerCase();

  if (provider === 'fish_audio' && (
    message.includes('insufficient balance')
    || message.includes('insufficient credits')
    || message.includes('invalid api key or insufficient balance')
  )) {
    return message;
  }
  if (provider === 'stepfun' && (
    message.includes('quota_exceeded')
    || message.includes('exceeded your current quota')
    || message.includes('billing details')
    || message.includes('insufficient balance')
    || message.includes('available balance')
    || message.includes('resource exhausted')
    || message.includes('resourceexhausted')
    || message.includes('ai_provider_rate_limited')
  )) {
    return message;
  }
  return '';
}

function registerSdkVNextProviderCapabilityMatrixTests(): void {
  const matrix = loadProviderCapabilityMatrix();
  const orderedProviders = [...matrix.keys()].sort((left, right) => left.localeCompare(right));
  const orderedCapabilities: readonly ProviderCapability[] = ['generate', 'embed', 'image', 'video', 'tts', 'stt', 'music', 'voice_clone', 'voice_design'];

  for (const provider of orderedProviders) {
    const capabilitySet = matrix.get(provider) || new Set<ProviderCapability>();
    for (const capability of orderedCapabilities) {
      if (!capabilitySet.has(capability)) continue;
      test(`nimi sdk vnext live smoke: ${provider} ${capability}`, {
        skip: process.env.NIMI_SDK_LIVE !== '1',
        timeout: 300_000,
      }, async (t) => {
        const runtimeEnv = buildRuntimeEnvForProvider(t, provider);
        if (!runtimeEnv) return;
        const modelId = capabilityModelId(t, provider, capability);
        if (!modelId) return;
        if (capability === 'stt' && !envValue(['NIMI_LIVE_STT_AUDIO_PATH', 'NIMI_LIVE_STT_AUDIO_URI'])) {
          t.skip('set NIMI_LIVE_STT_AUDIO_PATH or NIMI_LIVE_STT_AUDIO_URI to run stt live smoke');
          return;
        }
        if (
          capability === 'voice_clone'
          && !envValue([
            `NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_PATH`,
            'NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH',
            `NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI`,
            'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI',
          ])
        ) {
          t.skip(`set NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_PATH or NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI`);
          return;
        }

        await withRuntimeDaemon({
          appId: APP_ID,
          runtimeEnv,
          run: async ({ endpoint }) => {
            try {
              await runSdkVNextCapabilityLiveSmoke(endpoint, provider, capability, modelId);
            } catch (error) {
              const skipMessage = maybeProviderQuotaSkipMessage(provider, error);
              if (skipMessage) {
                t.skip(`${provider} live smoke skipped due to provider quota/balance block: ${skipMessage}`);
                return;
              }
              throw error;
            }
          },
        });
      });
    }
  }
}

test('nimi sdk vnext live smoke: helper contract is self-validating', () => {
  assert.equal(providerEnvToken('fish-audio'), 'FISH_AUDIO');
  assert.equal(normalizeCloudModelId('qwen-plus'), 'cloud/qwen-plus');
  assert.equal(normalizeCloudModelId('cloud/qwen-plus'), 'cloud/qwen-plus');
});

registerSdkVNextProviderCapabilityMatrixTests();
