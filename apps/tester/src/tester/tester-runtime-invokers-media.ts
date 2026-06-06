import { getTesterCapability } from './tester-capabilities.js';
import type {
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
  return {
    jobId: typeof record.jobId === 'string' ? record.jobId : '',
    jobState: typeof record.state === 'string'
      ? record.state
      : typeof record.status === 'string' ? (record.status as string) : 'unknown',
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
  try {
    const mediaImage = client.runtime.media?.image;
    if (!mediaImage) {
      throw new Error('Runtime media image facade is not exposed by vNext; migrate image.generate to Runtime Scenario jobs.');
    }
    const output = await mediaImage.generate({
      ...route,
      prompt,
      metadata: buildMetadata('nimi.tester.media.image.generate', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    }) as RuntimeMediaJobOutput;
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
      trace: pickTrace(output.trace),
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
    if (!mediaVideo) {
      throw new Error('Runtime media video facade is not exposed by vNext; migrate video.generate to Runtime Scenario jobs.');
    }
    const output = await mediaVideo.generate({
      mode: 't2v',
      ...route,
      prompt,
      content: [{ type: 'text', role: 'prompt', text: prompt }],
      metadata: buildMetadata('nimi.tester.media.video.generate', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    }) as RuntimeMediaJobOutput;
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
      trace: pickTrace(output.trace),
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
  try {
    const mediaTts = client.runtime.media?.tts;
    if (!mediaTts) {
      throw new Error('Runtime media TTS facade is not exposed by vNext; migrate audio.synthesize to Runtime Scenario jobs.');
    }
    const output = await mediaTts.synthesize({
      ...route,
      text: prompt,
      metadata: buildMetadata('nimi.tester.media.tts.synthesize', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    }) as RuntimeMediaJobOutput;
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
      trace: pickTrace(output.trace),
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
    const mediaStt = client.runtime.media?.stt;
    if (!mediaStt) {
      throw new Error('Runtime media STT facade is not exposed by vNext; migrate audio.transcribe to Runtime Scenario jobs.');
    }
    const output = await mediaStt.transcribe({
      ...route,
      audio: { kind: 'url', url },
      metadata: buildMetadata('nimi.tester.media.stt.transcribe', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    }) as RuntimeTranscriptOutput;
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
      trace: pickTrace(output.trace),
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
    if (!mediaTts) {
      throw new Error('Runtime media TTS voice facade is not exposed by vNext; migrate speech.bundle to Runtime Scenario jobs.');
    }
    const output = await mediaTts.listVoices({
      ...route,
      metadata: buildMetadata('nimi.tester.media.tts.list-voices', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    }) as RuntimeVoiceCatalogOutput;
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
