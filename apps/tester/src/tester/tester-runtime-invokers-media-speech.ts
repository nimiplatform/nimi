import {
  runNimiRuntimeSpeechSynthesis,
  runNimiRuntimeSpeechTranscription,
} from '@nimiplatform/sdk/features/generation';
import { getTesterCapability } from './tester-capabilities.js';
import type { TesterInvocationResult, TesterRuntimeInvocationClient, TesterScenarioInput } from './tester-runtime-invokers-core.js';
import {
  ensureSchedulingPreflight,
  isTesterUnavailable,
  requireRuntimeSubjectUserId,
  resolveTesterLLMBinding,
  runtimeRoutePayload,
  unavailableFromError,
  unavailableFromValidation,
} from './tester-runtime-invokers-core.js';
import { resolveLocalRunnableAssetBinding, resolveSpeechSynthesisParams } from './tester-runtime-media-bindings.js';
import { artifactsFrom, summariseArtifact, summariseJob, traceFromRuntimeOutput, type RuntimeMediaJobOutput, type RuntimeTranscriptOutput, type RuntimeVoiceCatalogOutput } from './tester-runtime-invokers-media-artifacts.js';
import { audioBytesFromUrl, isUnavailable, transcriptionParamsFromBinding } from './tester-runtime-invokers-media-params.js';
import { TESTER_APP_ID, runtimeJobHead, runtimeJobIdentity, runtimeLabels, withRuntimeClientTimeout } from './tester-runtime-invokers-media-runtime.js';

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
