import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AuthorizationPreset,
  ExecutionMode,
  ExternalPrincipalType,
  FallbackPolicy,
  PolicyMode,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
  VoiceReferenceKind,
  type RuntimeDurableTargetRef,
  type ScenarioSpec,
} from '../core-generated/runtime-typed-client';
import { createNimiRuntimeFullAppRegistration } from './app-session';
import { Runtime } from './index';
import { withRuntimeDaemon } from './live-runtime-daemon.test-helper';
import { toNimiRuntimeTimestamp } from './runtime-agent-values';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
  type NimiAIConfigTargetRef,
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
  readYamlFile,
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

type LiveRuntimeTargetRefs = {
  readonly aiConfig: NimiAIConfigTargetRef;
  readonly scenario: RuntimeDurableTargetRef;
};

type LiveCloudTargetConfig = {
  readonly connectorId: string;
  readonly remoteModelCatalogId: string;
};

const APP_ID = 'nimi.desktop.sdk.vnext.live';
const SUBJECT_USER_ID = 'user-sdk-vnext-live';
const LIVE_APP_INSTANCE_ID = `${APP_ID}.live-smoke`;
const LIVE_SCOPE_CATALOG_VERSION = 'sdk-v2';
const LIVE_VOICE_DESIGN_INSTRUCTION = 'Warm, calm, natural narrator voice with steady pacing, clear diction, low background noise, gentle emotional range, and a polished studio delivery for long-form spoken content.';
const LIVE_VOICE_CLONE_TEXT = 'Hello from Nimi SDK vNext live voice clone.';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROVIDER_API_KEY_ALIASES: Record<string, readonly string[]> = {
  mimo: ['MIMO_API_KEY'],
};

const providerSourceDocCache = new Map<string, any>();

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

function envTokens(keys: readonly string[]): string[] {
  return envValue(keys)
    .split(/[,\s]+/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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
  return loadSourceProviderCapabilityMatrix(
    resolve(REPO_ROOT, 'runtime', 'catalog', 'source', 'providers'),
  ) as Map<string, Set<ProviderCapability>>;
}

function providerApiKeyKeys(provider: string): readonly string[] {
  const token = providerEnvToken(provider);
  return [`NIMI_LIVE_${token}_API_KEY`, ...(PROVIDER_API_KEY_ALIASES[provider] || [])];
}

function sdkLiveProviderFilter(): Set<string> | null {
  const values = envTokens(['NIMI_SDK_LIVE_PROVIDER', 'NIMI_SDK_LIVE_PROVIDERS']);
  return values.length > 0 ? new Set(values) : null;
}

function sdkLiveCapabilityFilter(): Set<string> | null {
  const values = envTokens(['NIMI_SDK_LIVE_CAPABILITY', 'NIMI_SDK_LIVE_CAPABILITIES']);
  return values.length > 0 ? new Set(values) : null;
}

function providerAllowedByFilter(provider: string, filter: Set<string> | null): boolean {
  if (!filter) return true;
  return filter.has(provider.toLowerCase()) || filter.has(providerEnvToken(provider).toLowerCase());
}

function capabilityAllowedByFilter(capability: ProviderCapability, filter: Set<string> | null): boolean {
  return !filter || filter.has(capability);
}

function providerSourceDoc(provider: string): any {
  if (providerSourceDocCache.has(provider)) {
    return providerSourceDocCache.get(provider);
  }
  const sourcePath = resolve(REPO_ROOT, 'runtime', 'catalog', 'source', 'providers', `${provider}.source.yaml`);
  const doc = existsSync(sourcePath) ? readYamlFile(sourcePath) : {};
  providerSourceDocCache.set(provider, doc);
  return doc;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function sourceCapabilityForLive(capability: ProviderCapability): string {
  switch (capability) {
    case 'generate':
      return 'text.generate';
    case 'embed':
      return 'text.embed';
    case 'image':
      return 'image.generate';
    case 'video':
      return 'video.generate';
    case 'tts':
      return 'audio.synthesize';
    case 'voice_clone':
      return 'voice_workflow.voice_clone';
    case 'voice_design':
      return 'voice_workflow.voice_design';
    case 'stt':
      return 'audio.transcribe';
    case 'music':
      return 'music.generate';
    default:
      return '';
  }
}

function defaultVoiceWorkflowModelIdFromSource(provider: string, capability: ProviderCapability): string {
  const workflowType = capability === 'voice_clone'
    ? 'voice_clone'
    : capability === 'voice_design'
      ? 'voice_design'
      : '';
  if (!workflowType) return '';
  const doc = providerSourceDoc(provider);
  const workflowModels = Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : [];
  for (const entry of workflowModels) {
    if (String(entry?.workflow_type || '').trim().toLowerCase() !== workflowType) continue;
    const workflowModelId = String(entry?.workflow_model_id || '').trim();
    if (workflowModelId) return workflowModelId;
  }
  const bindings = Array.isArray(doc?.model_workflow_bindings) ? doc.model_workflow_bindings : [];
  for (const binding of bindings) {
    const workflowTypes = normalizeStringArray(binding?.workflow_types).map((value) => value.toLowerCase());
    if (!workflowTypes.includes(workflowType)) continue;
    const modelId = String(binding?.model_id || '').trim();
    if (modelId) return modelId;
  }
  return '';
}

function defaultCapabilityModelIdFromSource(provider: string, capability: ProviderCapability): string {
  const doc = providerSourceDoc(provider);
  if (capability === 'generate') {
    const defaultTextModel = String(doc?.defaults?.default_text_model || '').trim();
    if (defaultTextModel) return defaultTextModel;
  }
  if (capability === 'voice_clone' || capability === 'voice_design') {
    const workflowModelId = defaultVoiceWorkflowModelIdFromSource(provider, capability);
    if (workflowModelId) return workflowModelId;
  }
  const wanted = sourceCapabilityForLive(capability);
  if (!wanted) return '';
  const defaultCapabilities = normalizeStringArray(doc?.defaults?.capabilities).map((value) => value.toLowerCase());
  const models = Array.isArray(doc?.models) ? doc.models : [];
  for (const model of models) {
    const modelId = String(model?.model_id || '').trim();
    if (!modelId) continue;
    const capabilities = normalizeStringArray(model?.capabilities).map((value) => value.toLowerCase());
    const effectiveCapabilities = capabilities.length > 0 ? capabilities : defaultCapabilities;
    if (effectiveCapabilities.includes(wanted)) {
      return modelId;
    }
  }
  return '';
}

function requiredCapabilityModelIdOrSkip(
  t: { skip: (message?: string) => void },
  provider: string,
  capability: ProviderCapability,
  keys: readonly string[],
): string | null {
  const value = envValue(keys);
  if (value) return value;
  const sourceDefault = defaultCapabilityModelIdFromSource(provider, capability);
  if (sourceDefault) return sourceDefault;
  t.skip(`set one of ${keys.join(', ')} to run live smoke test`);
  return null;
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

function liveConnectorId(provider: string): string {
  if (provider === 'local') return '';
  return envValue([`NIMI_LIVE_${providerEnvToken(provider)}_CONNECTOR_ID`]);
}

function liveRemoteModelCatalogId(provider: string, capability: ProviderCapability): string {
  if (provider === 'local') return '';
  const token = providerEnvToken(provider);
  const capabilityToken = providerEnvToken(capability);
  return envValue([
    `NIMI_LIVE_${token}_${capabilityToken}_REMOTE_MODEL_CATALOG_ID`,
    `NIMI_LIVE_${token}_REMOTE_MODEL_CATALOG_ID`,
    'NIMI_LIVE_REMOTE_MODEL_CATALOG_ID',
  ]);
}

function requiredLiveCloudTargetConfigOrSkip(
  t: { skip: (message?: string) => void },
  provider: string,
  capability: ProviderCapability,
): LiveCloudTargetConfig | null {
  if (provider === 'local') return null;
  const connectorId = liveConnectorId(provider);
  if (!connectorId) {
    t.skip(`set NIMI_LIVE_${providerEnvToken(provider)}_CONNECTOR_ID to run cloud SDK vNext live smoke`);
    return null;
  }
  const remoteModelCatalogId = liveRemoteModelCatalogId(provider, capability);
  if (!remoteModelCatalogId) {
    t.skip(`set NIMI_LIVE_${providerEnvToken(provider)}_REMOTE_MODEL_CATALOG_ID or NIMI_LIVE_${providerEnvToken(provider)}_${providerEnvToken(capability)}_REMOTE_MODEL_CATALOG_ID to run cloud SDK vNext live smoke`);
    return null;
  }
  return { connectorId, remoteModelCatalogId };
}

function localRuntimeTargetRefs(localAssetId: string): LiveRuntimeTargetRefs {
  const profileBindingId = `local-runtime:${localAssetId}`;
  return {
    aiConfig: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId,
    },
    scenario: {
      target: {
        oneofKind: 'localRuntime',
        localRuntime: {
          version: 'v2',
          ref: { oneofKind: 'profileBindingId', profileBindingId },
        },
      },
    },
  };
}

function cloudRuntimeTargetRefs(
  provider: string,
  providerModelId: string,
  config: LiveCloudTargetConfig,
): LiveRuntimeTargetRefs {
  return {
    aiConfig: {
      kind: 'cloud-connector',
      connectorId: config.connectorId,
      remoteModelCatalogId: config.remoteModelCatalogId,
      providerModelId,
      provider,
    },
    scenario: {
      target: {
        oneofKind: 'cloud',
        cloud: {
          version: 'v2',
          connectorId: config.connectorId,
          remoteModelCatalogId: config.remoteModelCatalogId,
          providerModelId,
          provider,
        },
      },
    },
  };
}

function runtimeRoutePolicy(provider: string): RoutePolicy {
  return provider === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD;
}

function routedModelId(provider: string, modelId: string): string {
  return sdkRoutePolicy(provider) === 'cloud' ? normalizeCloudModelId(modelId) : modelId;
}

function runtimeTransport(endpoint: string) {
  return {
    type: 'node-grpc' as const,
    endpoint,
  };
}

function createRuntimeModule(endpoint: string): Runtime {
  const bootstrap = new Runtime({
    appId: APP_ID,
    transport: runtimeTransport(endpoint),
  });
  return new Runtime({
    appId: APP_ID,
    authMetadata: createRuntimeLiveProtectedAccessMetadataProvider(bootstrap),
    transport: runtimeTransport(endpoint),
  });
}

function createRuntimeLiveProtectedAccessMetadataProvider(
  bootstrap: Runtime,
): () => Promise<Record<string, string>> {
  const ensureRegistered = createNimiRuntimeFullAppRegistration(
    () => ({ auth: bootstrap.auth }),
    {
      appId: APP_ID,
      appInstanceId: LIVE_APP_INSTANCE_ID,
      deviceId: 'sdk-vnext-live',
      capabilities: ['ai.spend.meter'],
      developerRegistration: true,
    },
  );
  let cached: { readonly metadata: Record<string, string>; readonly expiresAtMs: number } | null = null;
  let inflight: Promise<{ readonly metadata: Record<string, string>; readonly expiresAtMs: number }> | null = null;
  return async () => {
    if (cached && cached.expiresAtMs - Date.now() > 60_000) {
      return cached.metadata;
    }
    inflight ??= (async () => {
      await ensureRegistered();
      const token = await bootstrap.grants.authorizeExternalPrincipal({
        domain: 'app-auth',
        appId: APP_ID,
        externalPrincipalId: APP_ID,
        externalPrincipalType: ExternalPrincipalType.APP,
        subjectUserId: SUBJECT_USER_ID,
        consentId: 'sdk-vnext-live-smoke',
        consentVersion: 'v1',
        decisionAt: toNimiRuntimeTimestamp(new Date()),
        policyVersion: 'sdk-vnext-live-smoke-v1',
        policyMode: PolicyMode.CUSTOM,
        preset: AuthorizationPreset.UNSPECIFIED,
        scopes: ['ai.spend.meter'],
        resourceSelectors: { conversationIds: [], messageIds: [], documentIds: [], labels: {} },
        canDelegate: false,
        maxDelegationDepth: 0,
        ttlSeconds: 3600,
        scopeCatalogVersion: LIVE_SCOPE_CATALOG_VERSION,
        policyOverride: false,
      }, withNimiRuntimeIdempotencyMetadata({
        metadata: { domain: 'app-auth' },
      }, randomUUID()));
      const tokenId = String(token.tokenId || '').trim();
      const secret = String(token.secret || '').trim();
      assert.ok(tokenId, 'live protected access token id should not be empty');
      assert.ok(secret, 'live protected access token secret should not be empty');
      return {
        metadata: {
          'x-nimi-access-token-id': tokenId,
          'x-nimi-access-token-secret': secret,
        },
        expiresAtMs: runtimeTimestampMillis(token.expiresAt) || Date.now() + 3_600_000,
      };
    })();
    try {
      cached = await inflight;
      return cached.metadata;
    } finally {
      inflight = null;
    }
  };
}

function runtimeTimestampMillis(timestamp: { readonly seconds?: string | number; readonly nanos?: number } | undefined): number {
  const seconds = Number(timestamp?.seconds || 0);
  const nanos = Number(timestamp?.nanos || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.floor(seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1_000_000 : 0));
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

  const apiKey = requiredAnyEnvOrSkip(t, providerApiKeyKeys(provider));
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
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_MODEL_ID`]);
    case 'embed':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_EMBED_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'image':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_IMAGE_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'video':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_VIDEO_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'tts':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_TTS_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'stt':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_STT_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'music':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_MUSIC_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'voice_clone':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_VOICE_CLONE_MODEL_ID`, `NIMI_LIVE_${token}_TTS_MODEL_ID`]);
    case 'voice_design':
      return requiredCapabilityModelIdOrSkip(t, provider, capability, [`NIMI_LIVE_${token}_VOICE_DESIGN_MODEL_ID`, `NIMI_LIVE_${token}_TTS_MODEL_ID`]);
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

function resolveLiveAudioPath(filePath: string): string {
  const normalized = String(filePath || '').trim();
  if (!normalized || isAbsolute(normalized)) {
    return normalized;
  }
  return resolve(REPO_ROOT, normalized);
}

function loadLiveAudioBytes(filePath: string): Uint8Array {
  const resolvedPath = resolveLiveAudioPath(filePath);
  const bytes = readFileSync(resolvedPath);
  assert.ok(bytes.length > 0, `${resolvedPath} should not be empty`);
  return new Uint8Array(bytes);
}

function resolveLiveSttAudioInput():
  | { readonly audio: { readonly type: 'bytes'; readonly bytes: Uint8Array }; readonly mimeType: string }
  | { readonly audio: { readonly type: 'url'; readonly url: string }; readonly mimeType: string }
  | null {
  const audioPath = envValue(['NIMI_LIVE_STT_AUDIO_PATH']);
  if (audioPath) {
    return {
      audio: { type: 'bytes', bytes: loadLiveAudioBytes(audioPath) },
      mimeType: resolveLiveAudioMime(audioPath),
    };
  }
  const audioUri = envValue(['NIMI_LIVE_STT_AUDIO_URI']);
  if (!audioUri) return null;
  return {
    audio: { type: 'url', url: audioUri },
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

  if (provider.toLowerCase() === 'dashscope' && audioUri) {
    return {
      referenceAudioBytes: new Uint8Array(),
      referenceAudioUri: audioUri,
      referenceAudioMime: resolveLiveAudioMime(audioUri),
      languageHints: [],
      preferredName: '',
      text,
    };
  }
  if (audioPath) {
    return {
      referenceAudioBytes: loadLiveAudioBytes(audioPath),
      referenceAudioUri: '',
      referenceAudioMime: resolveLiveAudioMime(audioPath),
      languageHints: [],
      preferredName: '',
      text,
    };
  }
  if (!audioUri) return null;
  return {
    referenceAudioBytes: new Uint8Array(),
    referenceAudioUri: audioUri,
    referenceAudioMime: resolveLiveAudioMime(audioUri),
    languageHints: [],
    preferredName: '',
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

async function importAndStartLocalManagedAsset(runtime: Runtime, modelId: string): Promise<string> {
  const manifestPath = localManagedManifestPath(modelId);
  const imported = await runtime.local.importLocalAsset({ manifestPath });
  const localAssetId = String(imported.asset?.localAssetId || '').trim();
  assert.ok(localAssetId, `local managed import should return localAssetId for ${modelId}`);
  await runtime.local.startLocalAsset({ localAssetId });
  return localAssetId;
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

function scenarioHead(provider: string, modelId: string, timeoutMs: number, targetRefs: LiveRuntimeTargetRefs) {
  return {
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
    modelId: routedModelId(provider, modelId),
    routePolicy: runtimeRoutePolicy(provider),
    fallback: FallbackPolicy.DENY,
    timeoutMs,
    connectorId: liveConnectorId(provider),
    targetRef: targetRefs.scenario,
  };
}

async function submitDirectScenario(
  runtime: Runtime,
  provider: string,
  modelId: string,
  targetRefs: LiveRuntimeTargetRefs,
  scenarioType: ScenarioType,
  spec: ScenarioSpec,
  timeoutMs: number,
) {
  const idempotencyKey = randomUUID();
  const response = await runtime.ai.submitScenarioJob({
    head: scenarioHead(provider, modelId, timeoutMs, targetRefs),
    scenarioType,
    executionMode: ExecutionMode.ASYNC_JOB,
    spec,
    requestId: randomUUID(),
    idempotencyKey,
    labels: {},
    extensions: [],
  }, withNimiRuntimeIdempotencyMetadata(undefined, idempotencyKey));
  const jobId = String(response.job?.jobId || '').trim();
  assert.ok(jobId, `scenario ${ScenarioType[scenarioType] || scenarioType} job id should not be empty`);
  return response;
}

async function assertSpeechSynthesisWithVoiceAsset(
  runtime: Runtime,
  provider: string,
  modelId: string,
  targetRefs: LiveRuntimeTargetRefs,
  voiceAssetId: string,
): Promise<void> {
  const response = await submitDirectScenario(runtime, provider, modelId, targetRefs, ScenarioType.SPEECH_SYNTHESIZE, {
    spec: {
      oneofKind: 'speechSynthesize',
      speechSynthesize: {
        text: 'Hello from Nimi SDK vNext live voice asset synthesis smoke.',
        voiceRef: {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: {
            oneofKind: 'voiceAssetId',
            voiceAssetId,
          },
        },
      },
    },
  }, 180_000);
  const job = await waitForScenarioJobDone(runtime, response.job?.jobId || '', 180_000);
  assert.equal(
    job?.status,
    ScenarioJobStatus.COMPLETED,
    `voice asset synthesis should complete: status=${job?.status} reasonCode=${job?.reasonCode} detail=${job?.reasonDetail || ''}`,
  );
  const artifacts = await runtime.ai.getScenarioArtifacts({ jobId: job?.jobId || response.job?.jobId || '' });
  assert.ok(artifacts.artifacts.length > 0, 'voice asset synthesis should return artifacts');
  const first = artifacts.artifacts[0];
  assert.ok((first.bytes?.length ?? 0) > 0 || String(first.uri || '').trim().length > 0, 'voice asset synthesis artifact should contain bytes or uri');
}

async function runSdkVNextCapabilityLiveSmoke(
  endpoint: string,
  provider: string,
  capability: ProviderCapability,
  modelId: string,
  cloudTargetConfig: LiveCloudTargetConfig | null,
): Promise<void> {
  const runtime = createRuntimeModule(endpoint);
  const route = sdkRoutePolicy(provider);
  const modelRef = {
    providerId: provider,
    modelId: routedModelId(provider, modelId),
  };
  let targetRefs: LiveRuntimeTargetRefs;

  if (provider === 'local') {
    const localAssetId = await importAndStartLocalManagedAsset(runtime, modelRef.modelId);
    targetRefs = localRuntimeTargetRefs(localAssetId);
  } else {
    assert.ok(cloudTargetConfig, 'cloud live smoke requires cloud target config');
    targetRefs = cloudRuntimeTargetRefs(provider, modelId, cloudTargetConfig);
  }

  if (capability === 'generate') {
    const model = createNimiRuntimeAIModel({
      runtime,
      model: modelRef,
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      routePolicy: route,
      connectorId: liveConnectorId(provider),
      timeoutMs: 45_000,
      targetRef: targetRefs.aiConfig,
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
      connectorId: liveConnectorId(provider),
      timeoutMs: 45_000,
      targetRef: targetRefs.aiConfig,
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
      connectorId: liveConnectorId(provider),
      timeoutMs: 240_000,
      targetRef: targetRefs.scenario,
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
    await submitDirectScenario(runtime, provider, modelId, targetRefs, ScenarioType.MUSIC_GENERATE, {
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
            preferredName: '',
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
    targetRefs,
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
    if (provider === 'mimo') {
      await assertSpeechSynthesisWithVoiceAsset(runtime, provider, targetModelId, targetRefs, voiceAssetId);
    }
    const deleted = await runtime.ai.deleteVoiceAsset(
      { voiceAssetId },
      withNimiRuntimeIdempotencyMetadata(undefined, `delete-voice:${voiceAssetId}:${randomUUID()}`),
    );
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
  const providerFilter = sdkLiveProviderFilter();
  const capabilityFilter = sdkLiveCapabilityFilter();

  for (const provider of orderedProviders) {
    if (!providerAllowedByFilter(provider, providerFilter)) continue;
    const capabilitySet = matrix.get(provider) || new Set<ProviderCapability>();
    for (const capability of orderedCapabilities) {
      if (!capabilitySet.has(capability)) continue;
      if (!capabilityAllowedByFilter(capability, capabilityFilter)) continue;
      test(`nimi sdk vnext live smoke: ${provider} ${capability}`, {
        skip: process.env.NIMI_SDK_LIVE !== '1',
        timeout: 300_000,
      }, async (t) => {
        const runtimeEnv = buildRuntimeEnvForProvider(t, provider);
        if (!runtimeEnv) return;
        const modelId = capabilityModelId(t, provider, capability);
        if (!modelId) return;
        const cloudTargetConfig = requiredLiveCloudTargetConfigOrSkip(t, provider, capability);
        if (provider !== 'local' && !cloudTargetConfig) return;
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
              await runSdkVNextCapabilityLiveSmoke(endpoint, provider, capability, modelId, cloudTargetConfig);
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
