import { ScenarioType } from '@nimiplatform/sdk/runtime/generated';
import { LOCAL_ONLY_STUDIO_PARAMETER, defineStudioParameters } from '../../ai-studio-core/parameters.js';
import { recoverStudioJobAction, submitStudioLocalJob, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type { StudioCapabilityRunResult } from '../../ai-studio-core/runtime-types.js';
import type { LabMediaFile } from './face-swap.js';
import { labJobNonSuccess, observeLabScenarioJob } from './lab-scenario-job.js';

export const LAB_SPEAKER_AUDIO_MIME_TYPES = ['audio/wav', 'audio/mpeg', 'audio/flac'] as const;
export const LAB_SPEAKER_AUDIO_MAX_BYTES = 32 * 1024 * 1024;
export type LabSpeakerEmbeddingParameters = { audio?: LabMediaFile };

export function isLabSpeakerAudio(file: LabMediaFile): boolean {
  return LAB_SPEAKER_AUDIO_MIME_TYPES.some(type => type === file.mimeType)
    && file.bytes instanceof Uint8Array && file.bytes.byteLength > 0
    && file.bytes.byteLength === file.sizeBytes && file.sizeBytes <= LAB_SPEAKER_AUDIO_MAX_BYTES;
}

export const labSpeakerEmbeddingParameters = defineStudioParameters<LabSpeakerEmbeddingParameters>({
  initial: () => ({}),
  routeMatrix: { audio: LOCAL_ONLY_STUDIO_PARAMETER },
  hasAlternativeInput: parameters => Boolean(parameters.audio && isLabSpeakerAudio(parameters.audio)),
  summarize: parameters => parameters.audio
    ? { audioName: parameters.audio.name, mediaType: parameters.audio.mimeType, sizeBytes: parameters.audio.sizeBytes }
    : {},
});

// @nimi-authority: rule.nimi.runtime.speaker-representation.audio-speaker-embedding-result
export async function runLabSpeakerEmbedding(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const recovery = await recoverStudioJobAction(context, ScenarioType.AUDIO_SPEAKER_EMBED);
  if (recovery?.saved) return recovery.saved;
  let jobId = recovery?.jobId;
  const { host, capability } = context;
  if (!jobId) {
    const audio = (context.input.parameters as LabSpeakerEmbeddingParameters | undefined)?.audio;
    if (!audio || !isLabSpeakerAudio(audio)) {
      return host.nonSuccess(capability, 'input-invalid', host.translate('CapabilityTests.speakerEmbedding.inputInvalid'));
    }
    context.input.signal?.throwIfAborted();
    const submitted = await submitStudioLocalJob(context, {
      type: 'audio-speaker-embed', mimeType: audio.mimeType,
      audioSource: { type: 'bytes', bytes: audio.bytes },
    }, { scenarioType: ScenarioType.AUDIO_SPEAKER_EMBED });
    jobId = submitted.job.jobId;
  }
  const outcome = await observeLabScenarioJob({
    ai: host.client.ai, jobId, scenarioType: ScenarioType.AUDIO_SPEAKER_EMBED,
    capability, nonSuccess: host.nonSuccess, cancelReason: host.abortReason,
    signal: context.input.observationSignal, cancelSignal: context.input.signal,
    onObservation: context.input.onObservation,
  });
  if (outcome.kind === 'non-success') return outcome.result;
  const result = outcome.job.speakerEmbedding;
  if (!result?.spaceId.trim() || !result.vector.length || result.vector.length > 4096
    || result.vector.some(value => !Number.isFinite(value))) {
    return labJobNonSuccess({ capability, nonSuccess: host.nonSuccess, jobId }, 'runtime-call-failed',
      host.translate('CapabilityTests.speakerEmbedding.resultInvalid'), outcome.job).result;
  }
  return {
    ok: true, capabilityId: capability.id, capabilityLabel: capability.label,
    message: host.translate('CapabilityTests.speakerEmbedding.completed', { dimensions: result.vector.length }),
    output: { kind: 'speaker-embedding', jobId, spaceId: result.spaceId, vector: [...result.vector] },
    ...(outcome.job.traceId ? { trace: { traceId: outcome.job.traceId } } : {}),
  };
}
