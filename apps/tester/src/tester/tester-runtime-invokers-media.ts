import {
  buildNimiRuntimeGenerationSubmitRequest,
  runNimiRuntimeSpeechSynthesis,
  runNimiRuntimeSpeechTranscription,
} from '@nimiplatform/sdk/features/generation';
import {
  buildNimiRuntimeLocalImageNativeEnvironmentPlanInput,
  createNimiRuntimeLocalModelCenterClient,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  runNimiRuntimeScenarioJob,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { getTesterCapability } from './tester-capabilities.js';
import type {
  ResolvedLLMBinding,
  TesterRuntimeInvocationClient,
  TesterScenarioInput,
  TesterInvocationResult,
} from './tester-runtime-invokers-core.js';
import {
  buildMetadata,
  ensureSchedulingPreflight,
  isTesterUnavailable,
  pickTrace,
  requireRuntimeSubjectUserId,
  resolveTesterLLMBinding,
  runtimeRoutePayload,
  unavailableFromError,
  unavailableFromValidation,
} from './tester-runtime-invokers-core.js';
import {
  imageProfileExtensions,
  resolveImageRuntimeBinding,
  resolveLocalRunnableAssetBinding,
  resolveSpeechSynthesisParams,
} from './tester-runtime-media-bindings.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';

type RuntimeMediaJobOutput = {
  readonly job?: unknown;
  readonly artifacts?: readonly unknown[];
  readonly trace?: unknown;
  readonly traceId?: string;
};

type RuntimeTranscriptOutput = RuntimeMediaJobOutput & {
  readonly text?: string;
};

type RuntimeVoiceCatalogOutput = {
  readonly modelResolved?: string;
  readonly voiceCount?: number;
  readonly voiceCatalogSource?: string;
  readonly voices?: readonly { readonly voiceId?: string; readonly name?: string; readonly lang?: string }[];
  readonly traceId?: string;
};

const TESTER_APP_ID = 'nimi.tester';

function artifactsFrom(output: RuntimeMediaJobOutput): readonly unknown[] {
  return Array.isArray(output.artifacts) ? output.artifacts : [];
}

// Normalize the runtime artifact `bytes` field into a Uint8Array regardless of
// how the transport delivered it (typed array, ArrayBuffer, number array, an
// index-map produced by a JSON IPC hop, or an already-base64 string).
function normalizeArtifactBytes(bytes: unknown): Uint8Array | undefined {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes as number[]);
  if (typeof bytes === 'string') {
    if (!bytes) return undefined;
    try {
      const binary = atob(bytes);
      const out = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        out[index] = binary.charCodeAt(index);
      }
      return out;
    } catch {
      return undefined;
    }
  }
  if (bytes && typeof bytes === 'object') {
    const view = bytes as { length?: unknown; [index: number]: unknown };
    if (typeof view.length === 'number' && view.length >= 0) {
      const out = new Uint8Array(view.length);
      for (let index = 0; index < view.length; index += 1) {
        out[index] = Number(view[index]) & 0xff;
      }
      return out;
    }
  }
  return undefined;
}

// Local runtime media (image / TTS / video) returns ScenarioArtifact `bytes`
// with an empty `uri`; only a cloud-hosted artifact carries a URL. Render the
// inline bytes as a data URL so the cockpit can display, play, and save the
// generated artifact instead of silently dropping it.
function artifactBytesToDataUrl(bytes: unknown, mimeType: string): string | undefined {
  const normalized = normalizeArtifactBytes(bytes);
  if (!normalized || normalized.length === 0) return undefined;
  const mime = mimeType.trim() || 'application/octet-stream';
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    binary += String.fromCharCode(...normalized.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function artifactIdFrom(record: Record<string, unknown>): string | undefined {
  const artifactId = typeof record.artifactId === 'string'
    ? record.artifactId
    : typeof record.artifact_id === 'string' ? record.artifact_id : '';
  return artifactId.trim() || undefined;
}

async function readRuntimeArtifactDataUrl(
  client: TesterRuntimeInvocationClient,
  artifactId: string,
  fallbackMimeType: string,
): Promise<{ readonly url?: string; readonly mimeType?: string }> {
  const reader = client.runtime.artifacts?.readArtifactBytes;
  if (!reader) return {};
  const response = await reader({ artifactId });
  const mimeType = typeof response.mimeType === 'string' && response.mimeType.trim()
    ? response.mimeType
    : fallbackMimeType;
  return {
    url: artifactBytesToDataUrl(response.bytes, mimeType),
    mimeType: mimeType || undefined,
  };
}

async function summariseArtifact(client: TesterRuntimeInvocationClient, artifact: unknown) {
  if (!artifact || typeof artifact !== 'object') return undefined;
  const record = artifact as Record<string, unknown>;
  const inline = record.inline as Record<string, unknown> | undefined;
  const mimeType = typeof record.mimeType === 'string' && record.mimeType
    ? record.mimeType
    : typeof inline?.mimeType === 'string' ? inline.mimeType : undefined;
  const hostedUrl = (typeof record.uri === 'string' && record.uri.trim())
    || (typeof record.url === 'string' && record.url.trim())
    || '';
  const artifactId = artifactIdFrom(record);
  const inlineUrl = artifactBytesToDataUrl(record.bytes ?? inline?.bytes, mimeType ?? '');
  const readBack = hostedUrl || inlineUrl || !artifactId
    ? {}
    : await readRuntimeArtifactDataUrl(client, artifactId, mimeType ?? '');
  const url = hostedUrl
    || inlineUrl
    || readBack.url
    || undefined;
  return {
    artifactId,
    mimeType: readBack.mimeType ?? mimeType,
    url,
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
  };
}

function summariseJob(job: unknown): { jobId: string; jobState: string } {
  if (!job || typeof job !== 'object') return { jobId: '', jobState: 'unknown' };
  const record = job as Record<string, unknown>;
  const status = record.status;
  return {
    jobId: typeof record.jobId === 'string'
      ? record.jobId
      : typeof record.id === 'string' ? record.id : '',
    jobState: typeof record.state === 'string'
      ? record.state
      : typeof status === 'string' ? status : scenarioJobStatusLabel(status),
  };
}

function scenarioJobStatusLabel(status: unknown): string {
  if (typeof status !== 'number') return 'unknown';
  switch (status) {
    case 1: return 'submitted';
    case 2: return 'queued';
    case 3: return 'running';
    case 4: return 'completed';
    case 5: return 'failed';
    case 6: return 'canceled';
    case 7: return 'timeout';
    default: return 'unknown';
  }
}

function runtimeRoutePolicy(resolved: ResolvedLLMBinding): 'local' | 'cloud' | 'unspecified' {
  if (resolved.routePolicy === 'local' || resolved.routePolicy === 'cloud') {
    return resolved.routePolicy;
  }
  return 'unspecified';
}

function runtimeJobHead(resolved: ResolvedLLMBinding, subjectUserId: string): {
  appId: string;
  subjectUserId: string;
  modelId: string;
  routePolicy: 'local' | 'cloud' | 'unspecified';
  connectorId?: string;
  timeoutMs: number;
} {
  return {
    appId: TESTER_APP_ID,
    subjectUserId,
    modelId: resolved.model,
    routePolicy: runtimeRoutePolicy(resolved),
    ...(resolved.connectorId ? { connectorId: resolved.connectorId } : {}),
    timeoutMs: 120_000,
  };
}

function stableIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function runtimeJobIdentity(capabilityId: string, scenarioId: string): {
  requestId: string;
  idempotencyKey: string;
} {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const prefix = `nimi.tester:${capabilityId}:${stableIdPart(scenarioId)}`;
  return {
    requestId: `${prefix}:${nonce}`,
    idempotencyKey: `${prefix}:${nonce}`,
  };
}

function traceFromScenarioJob(job: unknown, traceId?: string): { traceId?: string; modelResolved?: string; routeDecision?: string } | undefined {
  if (!job || typeof job !== 'object') {
    return traceId ? { traceId } : undefined;
  }
  const record = job as Record<string, unknown>;
  const routeDecision = record.routeDecision;
  return {
    traceId: traceId || (typeof record.traceId === 'string' ? record.traceId : undefined),
    modelResolved: typeof record.modelResolved === 'string' ? record.modelResolved : undefined,
    routeDecision: typeof routeDecision === 'string'
      ? routeDecision
      : typeof routeDecision === 'number' ? routePolicyLabel(routeDecision) : undefined,
  };
}

function traceFromRuntimeOutput(output: {
  readonly job?: unknown;
  readonly trace?: unknown;
  readonly traceId?: string;
}): { traceId?: string; modelResolved?: string; routeDecision?: string } | undefined {
  return pickTrace(output.trace) ?? traceFromScenarioJob(output.job, output.traceId);
}

function routePolicyLabel(value: number): string {
  if (value === 1) return 'local';
  if (value === 2) return 'cloud';
  return 'unspecified';
}

function runtimeCallTimeoutError(capabilityId: string, timeoutMs: number): Error {
  const error = new Error(`${capabilityId} Runtime call timed out after ${timeoutMs}ms; the Runtime request did not complete before the configured client deadline.`);
  error.name = 'RuntimeCallTimeoutError';
  return error;
}

async function withRuntimeClientTimeout<T>(
  capabilityId: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const normalizedTimeoutMs = Math.floor(Number(timeoutMs));
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    const controller = new AbortController();
    return run(controller.signal);
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(runtimeCallTimeoutError(capabilityId, normalizedTimeoutMs));
      controller.abort();
    }, normalizedTimeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function runtimeLabels(
  surfaceId: string,
  resolved: ResolvedLLMBinding,
  evidenceMetadata: Record<string, string>,
): Record<string, string> {
  return buildMetadata(surfaceId, {
    ...resolved.metadata,
    ...evidenceMetadata,
  });
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function selectedParamRecord(resolved: ResolvedLLMBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function optionalFiniteNumber(
  capabilityId: 'video.generate' | 'audio.transcribe',
  value: unknown,
  fieldName: string,
): number | TesterUnavailable | undefined {
  const raw = typeof value === 'number' ? String(value) : optionalText(value);
  if (!raw || raw.toLowerCase() === 'default' || raw.toLowerCase() === 'auto') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return unavailableFromValidation(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be a finite number.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  capabilityId: 'video.generate' | 'audio.transcribe',
  value: unknown,
  fieldName: string,
): number | TesterUnavailable | undefined {
  const parsed = optionalFiniteNumber(capabilityId, value, fieldName);
  if (parsed === undefined || isTesterUnavailable(parsed)) return parsed;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return unavailableFromValidation(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function isUnavailable(value: unknown): value is TesterUnavailable {
  return isTesterUnavailable(value);
}

function latestJobForDependency(
  jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[],
  dependency: NimiRuntimeLocalEnvironmentPlanDependency,
): NimiRuntimeLocalEnvironmentDependencyJob | null {
  return jobs
    .filter((job) =>
      job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId
      && job.consumerScope === dependency.consumerScope)
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] ?? null;
}

function nonReadyRequiredDependencies(plan: NimiRuntimeLocalEnvironmentPlan): readonly NimiRuntimeLocalEnvironmentPlanDependency[] {
  return plan.dependencies.filter((dependency) =>
    dependency.required && !isNimiRuntimeLocalEnvironmentDependencyReadyState(dependency.state));
}

function summarizeLocalImageDependencies(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): string {
  return dependencies
    .slice(0, 6)
    .map((dependency) => `${dependency.dependencyFamily}:${dependency.dependencyId} state=${dependency.state}`)
    .join('; ');
}

async function ensureLocalImageEnvironmentReady(
  client: TesterRuntimeInvocationClient,
  resolved: ResolvedLLMBinding,
): Promise<TesterUnavailable | null> {
  if (resolved.routePolicy !== 'local') return null;
  if (!client.runtime.local) {
    return capabilityUnavailable(
      getTesterCapability('image.generate'),
      'runtime-call-failed',
      'image.generate local model setup requires Runtime local environment APIs; reload Runtime projection and retry.',
    );
  }

  const local = createNimiRuntimeLocalModelCenterClient({ local: client.runtime.local });
  const plan = await local.resolveEnvironmentPlan(buildNimiRuntimeLocalImageNativeEnvironmentPlanInput({
    assetId: resolved.model,
    localAssetId: resolved.metadata.aiConfigRuntimeModelLocalAssetId,
  }));
  const blocked = nonReadyRequiredDependencies(plan);
  if (blocked.length === 0) return null;

  const jobsByDependency = await Promise.all(blocked.map(async (dependency) => ({
    dependency,
    job: latestJobForDependency(
      await local.listEnvironmentDependencyJobs({ environmentKey: dependency.environmentKey }),
      dependency,
    ),
  })));
  const startable = jobsByDependency
    .filter(({ dependency, job }) =>
      dependency.confirmationRequired &&
      isNimiRuntimeLocalEnvironmentDependencyStartableState(dependency.state)
      && !job)
    .map(({ dependency }) => dependency);

  if (startable.length > 0) {
    await Promise.all(startable.map((dependency) =>
      local.startEnvironmentDependencyJob({
        environmentKey: dependency.environmentKey,
        dependencyFamily: dependency.dependencyFamily,
        dependencyId: dependency.dependencyId,
        sourceKind: dependency.sourceKind,
        confirmed: true,
        consumerScope: dependency.consumerScope,
      }, { caller: 'core' }),
    ));
  }

  const activeCount = jobsByDependency.filter(({ job }) =>
    isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job?.state)).length;
  const summary = summarizeLocalImageDependencies(blocked);
  return capabilityUnavailable(
    getTesterCapability('image.generate'),
    'local-environment-preparing',
    startable.length > 0
      ? `Runtime local image setup started ${startable.length} dependency job(s). Pending dependencies: ${summary}`
      : `Runtime local image setup is still preparing (${activeCount} active job(s), plan=${plan.state}). Pending dependencies: ${summary}`,
  );
}

function booleanParam(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function videoParamsFromBinding(resolved: ResolvedLLMBinding): {
  mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  negativePrompt?: string;
  options: {
    ratio?: string;
    durationSec?: number;
    resolution?: string;
    fps?: number;
    seed?: string;
    cameraFixed?: boolean;
    generateAudio?: boolean;
  };
  timeoutMs?: number;
} | TesterUnavailable {
  const params = selectedParamRecord(resolved);
  const mode = optionalText(params.mode) || 't2v';
  if (!['t2v', 'i2v-first-frame', 'i2v-first-last', 'i2v-reference'].includes(mode)) {
    return unavailableFromValidation('video.generate', `NimiAIConfig selectedParams.mode is not supported: ${mode}.`);
  }
  const durationSec = optionalFiniteNumber('video.generate', params.durationSec, 'durationSec');
  if (isUnavailable(durationSec)) return durationSec;
  const fps = optionalPositiveInteger('video.generate', params.fps, 'fps');
  if (isUnavailable(fps)) return fps;
  const timeoutMs = optionalPositiveInteger('video.generate', params.timeoutMs, 'timeoutMs');
  if (isUnavailable(timeoutMs)) return timeoutMs;
  return {
    mode: mode as 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference',
    negativePrompt: optionalText(params.negativePrompt) || undefined,
    options: {
      ratio: optionalText(params.ratio) || undefined,
      durationSec,
      resolution: optionalText(params.resolution) || undefined,
      fps,
      seed: optionalText(params.seed) || undefined,
      cameraFixed: booleanParam(params.cameraFixed),
      generateAudio: booleanParam(params.generateAudio),
    },
    timeoutMs,
  };
}

function transcriptionParamsFromBinding(resolved: ResolvedLLMBinding): {
  language?: string;
  responseFormat?: string;
  speakerCount?: number;
  prompt?: string;
  timestamps?: boolean;
  diarization?: boolean;
  timeoutMs?: number;
} | TesterUnavailable {
  const params = selectedParamRecord(resolved);
  const speakerCount = optionalPositiveInteger('audio.transcribe', params.speakerCount, 'speakerCount');
  if (isUnavailable(speakerCount)) return speakerCount;
  const timeoutMs = optionalPositiveInteger('audio.transcribe', params.timeoutMs, 'timeoutMs');
  if (isUnavailable(timeoutMs)) return timeoutMs;
  return {
    language: optionalText(params.language) || undefined,
    responseFormat: optionalText(params.responseFormat) || undefined,
    speakerCount,
    prompt: optionalText(params.prompt) || undefined,
    timestamps: booleanParam(params.timestamps),
    diarization: booleanParam(params.diarization),
    timeoutMs,
  };
}

function mimeTypeForAudioUrl(url: string, contentType?: string | null): string {
  const normalizedContentType = optionalText(contentType).split(';')[0]?.trim();
  if (normalizedContentType) return normalizedContentType;
  const lower = url.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/wav';
}

async function audioBytesFromUrl(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audio.transcribe audio fetch failed (${response.status}) for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('audio.transcribe audio fetch returned an empty body.');
  }
  return {
    bytes,
    mimeType: mimeTypeForAudioUrl(url, response.headers.get('content-type')),
  };
}

export async function invokeImageGenerate(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('image.generate', 'Scenario prompt is empty — supply an image prompt before running image.generate.');
  }
  const resolved = resolveTesterLLMBinding('image.generate');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'image.generate', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const subjectUserId = requireRuntimeSubjectUserId('image.generate', client);
  try {
    const imageBinding = await resolveImageRuntimeBinding(client, resolved);
    const localEnvironmentUnavailable = await ensureLocalImageEnvironmentReady(client, imageBinding.resolved);
    if (localEnvironmentUnavailable) return localEnvironmentUnavailable;
    const route = runtimeRoutePayload(imageBinding.resolved);
    const extensions = imageProfileExtensions(imageBinding);
    const mediaImage = client.runtime.media?.image;
    const output = mediaImage
      ? await mediaImage.generate({
        ...route,
        subjectUserId,
        prompt,
        extensions,
        metadata: runtimeLabels('nimi.tester.media.image.generate', imageBinding.resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeMediaJobOutput
      : await runNimiRuntimeScenarioJob({
        ai: client.runtime.ai,
        request: buildNimiRuntimeGenerationSubmitRequest(runtimeJobHead(imageBinding.resolved, subjectUserId), {
          scenario: { kind: 'image', prompt },
          ...runtimeJobIdentity('image.generate', input.scenarioId),
          labels: runtimeLabels('nimi.tester.ai.image.generate', imageBinding.resolved, schedulingPreflight.evidenceMetadata),
          extensions,
        }),
      });
    const artifacts = artifactsFrom(output);
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'image.generate',
      capabilityLabel: getTesterCapability('image.generate').label,
      message: `Runtime accepted the image job (state=${job.jobState}, ${artifacts.length} artifact(s)).`,
      output: {
        kind: 'artifacts',
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: artifacts.length,
        firstArtifact: await summariseArtifact(client, artifacts[0]),
      },
      trace: traceFromRuntimeOutput(output),
    };
  } catch (error) {
    return unavailableFromError('image.generate', error);
  }
}

export async function invokeVideoGenerate(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('video.generate', 'Scenario prompt is empty — supply a video prompt before running video.generate.');
  }
  const resolved = resolveTesterLLMBinding('video.generate');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'video.generate', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = runtimeRoutePayload(resolved);
  const subjectUserId = requireRuntimeSubjectUserId('video.generate', client);
  try {
    const videoParams = videoParamsFromBinding(resolved);
    if (isUnavailable(videoParams)) return videoParams;
    const timeoutMs = videoParams.timeoutMs ?? 120_000;
    const mediaVideo = client.runtime.media?.video;
    const output = await withRuntimeClientTimeout('video.generate', timeoutMs, async (signal) => (
      mediaVideo
        ? await mediaVideo.generate({
          mode: videoParams.mode,
          ...route,
          subjectUserId,
          prompt,
          negativePrompt: videoParams.negativePrompt,
          options: videoParams.options,
          content: [{ type: 'text', role: 'prompt', text: prompt }],
          timeoutMs,
          signal,
          metadata: runtimeLabels('nimi.tester.media.video.generate', resolved, schedulingPreflight.evidenceMetadata),
        }) as RuntimeMediaJobOutput
        : await runNimiRuntimeScenarioJob({
          ai: client.runtime.ai,
          request: buildNimiRuntimeGenerationSubmitRequest({ ...runtimeJobHead(resolved, subjectUserId), timeoutMs }, {
            scenario: {
              kind: 'video',
              mode: videoParams.mode,
              prompt,
              negativePrompt: videoParams.negativePrompt,
              content: [{ type: 'text', role: 'prompt', text: prompt }],
              options: videoParams.options,
            },
            ...runtimeJobIdentity('video.generate', input.scenarioId),
            labels: runtimeLabels('nimi.tester.ai.video.generate', resolved, schedulingPreflight.evidenceMetadata),
          }),
          signal,
          abortReason: `tester_video_generate_timeout_${timeoutMs}ms`,
        })
    ));
    const artifacts = artifactsFrom(output);
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'video.generate',
      capabilityLabel: getTesterCapability('video.generate').label,
      message: `Runtime accepted the video job (state=${job.jobState}, ${artifacts.length} artifact(s)).`,
      output: {
        kind: 'artifacts',
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: artifacts.length,
        firstArtifact: await summariseArtifact(client, artifacts[0]),
      },
      trace: traceFromRuntimeOutput(output),
    };
  } catch (error) {
    return unavailableFromError('video.generate', error);
  }
}

export async function invokeSpeechSynthesize(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('audio.synthesize', 'Scenario prompt is empty — supply the text to synthesize before running audio.synthesize.');
  }
  const resolved = resolveTesterLLMBinding('audio.synthesize');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'audio.synthesize', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const subjectUserId = requireRuntimeSubjectUserId('audio.synthesize', client);
  try {
    const speechBinding = await resolveLocalRunnableAssetBinding({
      client,
      resolved,
      capabilityId: 'audio.synthesize',
      assetKind: 'tts',
    });
    const route = runtimeRoutePayload(speechBinding);
    const speechParams = await resolveSpeechSynthesisParams({
      client,
      resolved: speechBinding,
      subjectUserId,
    });
    const timeoutMs = speechParams.timeoutMs ?? 120_000;
    const mediaTts = client.runtime.media?.tts;
    const output = await withRuntimeClientTimeout('audio.synthesize', timeoutMs, async (signal) => (
      mediaTts
        ? await mediaTts.synthesize({
          ...route,
          subjectUserId,
          text: prompt,
          voiceRef: speechParams.voiceRef,
          language: speechParams.language,
          audioFormat: speechParams.audioFormat,
          responseFormat: speechParams.audioFormat,
          speed: speechParams.speed,
          pitch: speechParams.pitch,
          volume: speechParams.volume,
          timeoutMs,
          signal,
          metadata: runtimeLabels('nimi.tester.media.tts.synthesize', speechBinding, schedulingPreflight.evidenceMetadata),
        }) as RuntimeMediaJobOutput
        : await runNimiRuntimeSpeechSynthesis({
          runtime: client.runtime,
          head: {
            ...runtimeJobHead(speechBinding, subjectUserId),
            timeoutMs,
          },
          text: prompt,
          voiceRef: speechParams.voiceRef,
          language: speechParams.language,
          audioFormat: speechParams.audioFormat,
          speed: speechParams.speed,
          pitch: speechParams.pitch,
          volume: speechParams.volume,
          ...runtimeJobIdentity('audio.synthesize', input.scenarioId),
          labels: runtimeLabels('nimi.tester.ai.speech.synthesize', speechBinding, schedulingPreflight.evidenceMetadata),
          signal,
          abortReason: `tester_audio_synthesize_timeout_${timeoutMs}ms`,
        })
    ));
    const artifacts = artifactsFrom(output);
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'audio.synthesize',
      capabilityLabel: getTesterCapability('audio.synthesize').label,
      message: `Runtime accepted the synthesis job (state=${job.jobState}, ${artifacts.length} artifact(s)).`,
      output: {
        kind: 'artifacts',
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: artifacts.length,
        firstArtifact: await summariseArtifact(client, artifacts[0]),
      },
      trace: traceFromRuntimeOutput(output),
    };
  } catch (error) {
    return unavailableFromError('audio.synthesize', error);
  }
}

export async function invokeSpeechTranscribe(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const url = input.prompt.trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://'))) {
    return unavailableFromValidation(
      'audio.transcribe',
      'audio.transcribe requires the scenario field to contain an http(s):// or file:// URL pointing at the audio asset.',
    );
  }
  const resolved = resolveTesterLLMBinding('audio.transcribe');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'audio.transcribe', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = runtimeRoutePayload(resolved);
  const subjectUserId = requireRuntimeSubjectUserId('audio.transcribe', client);
  try {
    const transcriptionParams = transcriptionParamsFromBinding(resolved);
    if (isUnavailable(transcriptionParams)) return transcriptionParams;
    const timeoutMs = transcriptionParams.timeoutMs ?? 120_000;
    const audio = await audioBytesFromUrl(url);
    const mediaStt = client.runtime.media?.stt;
    const output = await withRuntimeClientTimeout('audio.transcribe', timeoutMs, async (signal) => (
      mediaStt
        ? await mediaStt.transcribe({
          ...route,
          subjectUserId,
          audio: { kind: 'bytes', bytes: audio.bytes },
          mimeType: audio.mimeType,
          language: transcriptionParams.language,
          responseFormat: transcriptionParams.responseFormat,
          speakerCount: transcriptionParams.speakerCount,
          prompt: transcriptionParams.prompt,
          timestamps: transcriptionParams.timestamps,
          diarization: transcriptionParams.diarization,
          timeoutMs,
          signal,
          metadata: runtimeLabels('nimi.tester.media.stt.transcribe', resolved, schedulingPreflight.evidenceMetadata),
        }) as RuntimeTranscriptOutput
        : await runNimiRuntimeSpeechTranscription({
          runtime: client.runtime,
          head: { ...runtimeJobHead(resolved, subjectUserId), timeoutMs },
          audio: { type: 'bytes', bytes: audio.bytes },
          mimeType: audio.mimeType,
          language: transcriptionParams.language,
          responseFormat: transcriptionParams.responseFormat,
          speakerCount: transcriptionParams.speakerCount,
          prompt: transcriptionParams.prompt,
          timestamps: transcriptionParams.timestamps,
          diarization: transcriptionParams.diarization,
          ...runtimeJobIdentity('audio.transcribe', input.scenarioId),
          labels: runtimeLabels('nimi.tester.ai.speech.transcribe', resolved, schedulingPreflight.evidenceMetadata),
          signal,
          abortReason: `tester_audio_transcribe_timeout_${timeoutMs}ms`,
        })
    ));
    const artifacts = artifactsFrom(output);
    const text = output.text ?? '';
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'audio.transcribe',
      capabilityLabel: getTesterCapability('audio.transcribe').label,
      message: `Runtime returned transcript (${text.length} chars, jobState=${job.jobState}).`,
      output: {
        kind: 'transcript',
        text,
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: artifacts.length,
      },
      trace: traceFromRuntimeOutput(output),
    };
  } catch (error) {
    return unavailableFromError('audio.transcribe', error);
  }
}

export async function invokeSpeechBundle(client: TesterRuntimeInvocationClient, _input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const resolved = resolveTesterLLMBinding('speech.bundle');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'speech.bundle', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = runtimeRoutePayload(resolved);
  const subjectUserId = requireRuntimeSubjectUserId('speech.bundle', client);
  try {
    const mediaTts = client.runtime.media?.tts;
    const output = mediaTts
      ? await mediaTts.listVoices({
        ...route,
        subjectUserId,
        metadata: runtimeLabels('nimi.tester.media.tts.list-voices', resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeVoiceCatalogOutput
      : await client.runtime.ai.listPresetVoices?.({
        appId: TESTER_APP_ID,
        subjectUserId,
        modelId: resolved.model,
        targetModelId: resolved.model,
        connectorId: resolved.connectorId ?? '',
      }) as RuntimeVoiceCatalogOutput | undefined;
    if (!output) {
      throw new Error('Runtime AI voice catalog facade is not exposed by vNext.');
    }
    const voices = output.voices ?? [];
    return {
      ok: true,
      capabilityId: 'speech.bundle',
      capabilityLabel: getTesterCapability('speech.bundle').label,
      message: `Runtime returned ${voices.length} voice(s) from catalog "${output.voiceCatalogSource || 'default'}".`,
      output: {
        kind: 'voice-catalog',
        modelResolved: output.modelResolved ?? 'unresolved',
        voiceCount: output.voiceCount ?? voices.length,
        sample: voices.slice(0, 4).map((voice) => ({
          voiceId: voice.voiceId ?? '',
          name: voice.name ?? '',
          lang: voice.lang ?? '',
        })),
      },
      trace: { traceId: output.traceId, modelResolved: output.modelResolved },
    };
  } catch (error) {
    return unavailableFromError('speech.bundle', error);
  }
}
