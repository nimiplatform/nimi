import type { NimiLocalAppAudioInfo } from '@nimiplatform/sdk/app';
import type { NimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
import { beginMusicRecovery, captureMusicRecoveryJobId, readMusicRecovery, restoreSavedMusicResult, saveMusicRecoveryResult } from './music-recovery.js';
import { createStudioScenarioJobClient, projectStudioArtifactRunnerResult, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type { StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import type { StudioAudioSeparateParameters } from './parameters.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
export async function runAudioSeparate(context: StudioCapabilityRuntimeContext) {
  const parameters = context.input.parameters as StudioAudioSeparateParameters | undefined;
  const client = context.host.client; const signal = context.input.signal;
  if (parameters?.recoverySubmissionId) {
    const entry = (await readMusicRecovery(client.storage, 'audio.separate')).find(item => item.clientSubmissionId === parameters.recoverySubmissionId);
    if (!entry?.sourceAudio) throw new Error(context.host.translate('Music.recoveryMissing'));
    const saved = restoreSavedMusicResult(entry, context.capability.label, 'audio.separate');
    if (saved) return saved;
    if (!entry.jobId) throw new Error(context.host.translate('AudioSeparate.recoveryMissingJob'));
    const result = await context.host.runners.audioSeparationObserve({ runtime: { ai: createStudioScenarioJobClient(context) },
      jobId: entry.jobId, signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
    const projected = await projectStudioArtifactRunnerResult({ ...context, separationSourceAudio: entry.sourceAudio }, result);
    await saveMusicRecoveryResult(client.storage, entry.clientSubmissionId, projected, 'audio.separate');
    return projected;
  }
  const invalid = () => context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('AudioSeparate.configureInputs'));
  if (!parameters?.sourceRelativePath || !parameters.sourceMimeType) return invalid();
  const snapshot = await client.aiConfig.get();
  const selection = snapshot.effectiveSelections.find(item => item.capabilityContract === 'audio.separate');
  if (selection?.state !== 'ready') return invalid();
  const original = await client.storage.assets.stat(parameters.sourceRelativePath);
  if (original.sizeBytes < 1 || original.mediaType !== parameters.sourceMimeType) return invalid();
  signal?.throwIfAborted();
  // Runtime owns decoding and the frame basis. These unary preparations cannot
  // be interrupted by the App; cancellation abandons submission when they settle.
  const prepared = await client.ai.artifacts.upload({ source: { kind: 'app-asset', relativePath: original.relativePath },
    mimeType: parameters.sourceMimeType, audioPreparation: { profile: 'canonical-pcm-v1' } });
  signal?.throwIfAborted();
  let sourceInfo = prepared.audioInfo;
  if (!sourceInfo || prepared.mimeType !== 'audio/wav') return invalid();
  // The native separation implementation accepts only its declared 44100 Hz
  // stereo domain; anything else is converted through an explicit derived
  // preparation, never a hidden resample.
  let separationInput = prepared;
  if (sourceInfo.sampleRateHz !== 44100 || sourceInfo.channels !== 2) {
    const channelMode = sourceInfo.channels === 1 ? 'MONO_TO_STEREO' as const
      : sourceInfo.channels === 2 ? 'PRESERVE' as const : 'STEREO_TO_MONO' as const;
    separationInput = await client.ai.artifacts.upload({ source: { kind: 'artifact', artifactId: prepared.artifactId },
      mimeType: 'audio/wav', audioPreparation: { profile: 'canonical-pcm-v1', targetSampleRateHz: 44100, channelMode } });
    signal?.throwIfAborted();
    sourceInfo = separationInput.audioInfo;
    if (!sourceInfo || sourceInfo.sampleRateHz !== 44100 || sourceInfo.channels !== 2 || sourceInfo.frameCount < 1) return invalid();
  }
  const sourceRangeResult = resolveRange(parameters.startSeconds, parameters.endSeconds, sourceInfo);
  if (sourceRangeResult === 'invalid') return invalid();
  const sourceRange = sourceRangeResult;
  const adopted = await client.storage.assets.adoptArtifact({ artifactId: separationInput.artifactId,
    relativePath: `studio/music/audio-separate-inputs/${crypto.randomUUID()}/source.wav`, overwrite: false });
  const sourceAudio: StudioManagedArtifact = { relativePath: adopted.relativePath, mediaType: adopted.mediaType,
    sizeBytes: adopted.sizeBytes, sha256: adopted.sha256, displayName: parameters.sourceName, previewSource: 'managed-asset' };
  let clientSubmissionId: string;
  try {
    signal?.throwIfAborted();
    if (adopted.sizeBytes !== separationInput.sizeBytes || adopted.mediaType !== separationInput.mimeType) throw new Error('Canonical source adoption changed metadata');
    clientSubmissionId = await beginMusicRecovery(client.storage, 'audio.separate', sourceAudio);
  } catch (cause) { await client.storage.assets.remove(adopted.relativePath); throw cause; }
  const scenarioClient = createStudioScenarioJobClient(context);
  let capturedJobId: string | undefined;
  let jobIdCapture: Promise<unknown> = Promise.resolve();
  const captureJobId = (jobId: string | undefined) => {
    if (!jobId || capturedJobId) return;
    capturedJobId = jobId;
    jobIdCapture = captureMusicRecoveryJobId(client.storage, clientSubmissionId, jobId, 'audio.separate');
  };
  let result;
  try {
    result = await context.host.runners.audioSeparate({ runtime: { ai: scenarioClient }, appId: context.host.appId,
      mimeType: separationInput.mimeType,
      sourceAudio: { artifactId: separationInput.artifactId, ...(sourceRange ? { range: sourceRange } : {}) },
      ...(parameters.includeInstrumentParts ? { includeInstrumentParts: true } : {}),
      scenarioId: context.scenarioId, surfaceId: context.host.surfaceId,
      signal, abortReason: context.host.abortReason,
      onJobUpdate: (job: NimiRuntimeScenarioJob) => { captureJobId(job.jobId); context.input.onJobUpdate?.(job); } });
  } catch (cause) {
    await jobIdCapture.catch(() => undefined);
    throw cause;
  }
  if (result.ok) captureJobId(result.output.jobId);
  await jobIdCapture.catch(() => undefined);
  const projected = await projectStudioArtifactRunnerResult({ ...context, separationSourceAudio: sourceAudio }, result);
  await saveMusicRecoveryResult(client.storage, clientSubmissionId, projected, 'audio.separate');
  return projected;
}

function resolveRange(startSeconds: number | undefined, endSeconds: number | undefined, info: NimiLocalAppAudioInfo) {
  if (startSeconds === undefined && endSeconds === undefined) return undefined;
  const startFrame = Math.round((startSeconds ?? 0) * info.sampleRateHz);
  const endFrame = endSeconds === undefined ? info.frameCount : Math.round(endSeconds * info.sampleRateHz);
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || startFrame >= endFrame || endFrame > info.frameCount) return 'invalid';
  return { startFrame, endFrame };
}
