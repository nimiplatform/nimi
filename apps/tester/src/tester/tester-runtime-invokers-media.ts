import {
  buildNimiRuntimeGenerationSubmitRequest,
  runNimiRuntimeSpeechSynthesis,
  runNimiRuntimeSpeechTranscription,
} from '@nimiplatform/sdk/features/generation';
import {
  runNimiRuntimeScenarioJob,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeVoiceReference,
  type NimiRuntimeSpeechVoiceReference,
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
  resolveTesterLLMBinding,
  routeInput,
  unavailableFromError,
  unavailableFromValidation,
} from './tester-runtime-invokers-core.js';

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

function summariseArtifact(artifact: unknown) {
  if (!artifact || typeof artifact !== 'object') return undefined;
  const record = artifact as Record<string, unknown>;
  const inline = record.inline as Record<string, unknown> | undefined;
  const mimeType = typeof record.mimeType === 'string' && record.mimeType
    ? record.mimeType
    : typeof inline?.mimeType === 'string' ? inline.mimeType : undefined;
  const hostedUrl = (typeof record.uri === 'string' && record.uri.trim())
    || (typeof record.url === 'string' && record.url.trim())
    || '';
  const url = hostedUrl
    || artifactBytesToDataUrl(record.bytes ?? inline?.bytes, mimeType ?? '')
    || undefined;
  return {
    artifactId: typeof record.artifactId === 'string' ? record.artifactId : undefined,
    mimeType,
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

function runtimeJobHead(resolved: ResolvedLLMBinding): {
  appId: string;
  modelId: string;
  routePolicy: 'local' | 'cloud' | 'unspecified';
  connectorId?: string;
  timeoutMs: number;
} {
  return {
    appId: TESTER_APP_ID,
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

function selectedParamRecord(resolved: ResolvedLLMBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function imageProfileExtensions(resolved: ResolvedLLMBinding) {
  const params = selectedParamRecord(resolved);
  const configuredEntries = Array.isArray(params.profile_entries)
    ? params.profile_entries
    : Array.isArray(params.profileEntries) ? params.profileEntries : null;
  const profileEntries = configuredEntries && configuredEntries.length > 0
    ? configuredEntries
    : [{
      entry_id: 'main-image',
      kind: 'asset',
      title: 'Main image model',
      capability: 'image.generate',
      asset_id: resolved.model,
      asset_kind: 'image',
      engine: 'media',
      required: true,
    }];
  return [{
    namespace: 'nimi.scenario.image.request',
    payload: toNimiRuntimeProtoStruct({
      ...params,
      profile_entries: profileEntries,
    }),
  }];
}

function parseVoiceReference(value: unknown): NimiRuntimeSpeechVoiceReference | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const kind = optionalText(record.kind);
    if (kind === 'preset_voice_id') {
      return { kind, presetVoiceId: optionalText(record.presetVoiceId ?? record.preset_voice_id) };
    }
    if (kind === 'voice_asset_id') {
      return { kind, voiceAssetId: optionalText(record.voiceAssetId ?? record.voice_asset_id) };
    }
    if (kind === 'provider_voice_ref') {
      return { kind, providerVoiceRef: optionalText(record.providerVoiceRef ?? record.provider_voice_ref) };
    }
    const providerVoiceRef = optionalText(record.providerVoiceRef ?? record.provider_voice_ref);
    if (providerVoiceRef) return { kind: 'provider_voice_ref', providerVoiceRef };
    const presetVoiceId = optionalText(record.presetVoiceId ?? record.preset_voice_id);
    if (presetVoiceId) return { kind: 'preset_voice_id', presetVoiceId };
    const voiceAssetId = optionalText(record.voiceAssetId ?? record.voice_asset_id);
    if (voiceAssetId) return { kind: 'voice_asset_id', voiceAssetId };
    return undefined;
  }
  const text = optionalText(value);
  if (!text) return undefined;
  const [prefix, ...rest] = text.split(':');
  const payload = rest.join(':').trim();
  if (prefix === 'preset_voice_id' && payload) return { kind: 'preset_voice_id', presetVoiceId: payload };
  if (prefix === 'voice_asset_id' && payload) return { kind: 'voice_asset_id', voiceAssetId: payload };
  if (prefix === 'provider_voice_ref' && payload) return { kind: 'provider_voice_ref', providerVoiceRef: payload };
  return { kind: 'provider_voice_ref', providerVoiceRef: text };
}

function voiceReferenceFromParams(resolved: ResolvedLLMBinding) {
  const params = selectedParamRecord(resolved);
  return toNimiRuntimeVoiceReference(parseVoiceReference(
    params.voiceRef
    ?? params.voice_ref
    ?? params.providerVoiceRef
    ?? params.provider_voice_ref
    ?? params.presetVoiceId
    ?? params.preset_voice_id
    ?? params.voiceAssetId
    ?? params.voice_asset_id,
  ));
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
  const route = routeInput(resolved);
  const extensions = imageProfileExtensions(resolved);
  try {
    const mediaImage = client.runtime.media?.image;
    const output = mediaImage
      ? await mediaImage.generate({
        ...route,
        prompt,
        extensions,
        metadata: runtimeLabels('nimi.tester.media.image.generate', resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeMediaJobOutput
      : await runNimiRuntimeScenarioJob({
        ai: client.runtime.ai,
        request: buildNimiRuntimeGenerationSubmitRequest(runtimeJobHead(resolved), {
          scenario: { kind: 'image', prompt },
          ...runtimeJobIdentity('image.generate', input.scenarioId),
          labels: runtimeLabels('nimi.tester.ai.image.generate', resolved, schedulingPreflight.evidenceMetadata),
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
        firstArtifact: summariseArtifact(artifacts[0]),
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
  const route = routeInput(resolved);
  try {
    const mediaVideo = client.runtime.media?.video;
    const output = mediaVideo
      ? await mediaVideo.generate({
        mode: 't2v',
        ...route,
        prompt,
        content: [{ type: 'text', role: 'prompt', text: prompt }],
        metadata: runtimeLabels('nimi.tester.media.video.generate', resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeMediaJobOutput
      : await runNimiRuntimeScenarioJob({
        ai: client.runtime.ai,
        request: buildNimiRuntimeGenerationSubmitRequest(runtimeJobHead(resolved), {
          scenario: {
            kind: 'video',
            mode: 't2v',
            prompt,
            content: [{ type: 'text', role: 'prompt', text: prompt }],
          },
          ...runtimeJobIdentity('video.generate', input.scenarioId),
          labels: runtimeLabels('nimi.tester.ai.video.generate', resolved, schedulingPreflight.evidenceMetadata),
        }),
      });
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
        firstArtifact: summariseArtifact(artifacts[0]),
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
  const route = routeInput(resolved);
  const voiceRef = voiceReferenceFromParams(resolved);
  try {
    const mediaTts = client.runtime.media?.tts;
    const output = mediaTts
      ? await mediaTts.synthesize({
        ...route,
        text: prompt,
        voiceRef,
        metadata: runtimeLabels('nimi.tester.media.tts.synthesize', resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeMediaJobOutput
      : await runNimiRuntimeSpeechSynthesis({
        runtime: client.runtime,
        head: runtimeJobHead(resolved),
        text: prompt,
        voiceRef,
        audioFormat: 'wav',
        ...runtimeJobIdentity('audio.synthesize', input.scenarioId),
        labels: runtimeLabels('nimi.tester.ai.speech.synthesize', resolved, schedulingPreflight.evidenceMetadata),
      });
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
        firstArtifact: summariseArtifact(artifacts[0]),
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
  const route = routeInput(resolved);
  try {
    const audio = await audioBytesFromUrl(url);
    const mediaStt = client.runtime.media?.stt;
    const output = mediaStt
      ? await mediaStt.transcribe({
        ...route,
        audio: { kind: 'bytes', bytes: audio.bytes },
        mimeType: audio.mimeType,
        metadata: runtimeLabels('nimi.tester.media.stt.transcribe', resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeTranscriptOutput
      : await runNimiRuntimeSpeechTranscription({
        runtime: client.runtime,
        head: runtimeJobHead(resolved),
        audio: { type: 'bytes', bytes: audio.bytes },
        mimeType: audio.mimeType,
        ...runtimeJobIdentity('audio.transcribe', input.scenarioId),
        labels: runtimeLabels('nimi.tester.ai.speech.transcribe', resolved, schedulingPreflight.evidenceMetadata),
      });
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
  const route = routeInput(resolved);
  try {
    const mediaTts = client.runtime.media?.tts;
    const output = mediaTts
      ? await mediaTts.listVoices({
        ...route,
        metadata: runtimeLabels('nimi.tester.media.tts.list-voices', resolved, schedulingPreflight.evidenceMetadata),
      }) as RuntimeVoiceCatalogOutput
      : await client.runtime.ai.listPresetVoices?.({
        appId: TESTER_APP_ID,
        subjectUserId: '',
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
