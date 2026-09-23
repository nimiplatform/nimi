import type { NimiLocalAppAudioInfo, NimiLocalAppVoiceConvertTargetVoice } from '@nimiplatform/sdk/app';
import { beginMusicRecovery, readMusicRecovery, restoreSavedMusicResult, saveMusicRecoveryResult } from './music-recovery.js';
import { createStudioScenarioJobClient, projectStudioArtifactRunnerResult, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type { StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import type { StudioVoiceConvertParameters } from './parameters.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
export async function runVoiceConvert(context: StudioCapabilityRuntimeContext) {
  const parameters = context.input.parameters as StudioVoiceConvertParameters | undefined;
  const client = context.host.client; const signal = context.input.signal;
  if (parameters?.recoverySubmissionId) {
    const entry = (await readMusicRecovery(client.storage, 'audio.voice.convert')).find(item => item.clientSubmissionId === parameters.recoverySubmissionId);
    if (!entry?.sourceAudio) throw new Error(context.host.translate('Music.recoveryMissing'));
    const saved = restoreSavedMusicResult(entry, context.capability.label, 'audio.voice.convert');
    if (saved) return saved;
    const found = await client.ai.scenarioJobs.lookupSubmission(entry.clientSubmissionId);
    const result = await context.host.runners.voiceConversionObserve({ runtime: { ai: createStudioScenarioJobClient(context) },
      jobId: found.job.jobId, signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
    const projected = await projectStudioArtifactRunnerResult({ ...context, voiceSourceVocal: entry.sourceAudio, voiceTargetAudio: entry.targetAudio }, result);
    await saveMusicRecoveryResult(client.storage, entry.clientSubmissionId, projected, 'audio.voice.convert');
    return projected;
  }
  const invalid = () => context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('VoiceConvert.configureInputs'));
  const targetKind = parameters?.targetKind;
  const presetVoiceId = parameters?.targetPresetVoiceId?.trim();
  const voiceAssetId = parameters?.targetVoiceAssetId?.trim();
  if (!parameters?.sourceRelativePath || !parameters.sourceMimeType || !targetKind) return invalid();
  if (targetKind === 'reference-audio' ? !parameters.targetRelativePath || !parameters.targetMimeType
    : targetKind === 'preset' ? !presetVoiceId
    : targetKind === 'voice-asset' ? !voiceAssetId
    : true) return invalid();
  const semitoneShift = parameters.semitoneShift;
  if (semitoneShift !== undefined && (!Number.isSafeInteger(semitoneShift) || semitoneShift < -12 || semitoneShift > 12)) return invalid();
  const snapshot = await client.aiConfig.get();
  const selection = snapshot.effectiveSelections.find(item => item.capabilityContract === 'audio.voice.convert');
  const resource = selection?.resource;
  const capabilities = resource?.oneofKind === 'local' ? resource.local.musicInput : undefined;
  const hasRange = parameters.sourceStartSeconds !== undefined || parameters.sourceEndSeconds !== undefined
    || parameters.targetStartSeconds !== undefined || parameters.targetEndSeconds !== undefined;
  const profile = capabilities?.voiceConvert?.find(item => item.sourceKinds.includes('singing') && item.targetKinds.includes(targetKind)
    && (semitoneShift === undefined || semitoneShift === 0 || (item.supportsSemitoneShift && semitoneShift >= item.minSemitoneShift && semitoneShift <= item.maxSemitoneShift))
    && (!hasRange || item.supportsRange));
  if (selection?.state !== 'ready' || !profile) return invalid();
  const original = await client.storage.assets.stat(parameters.sourceRelativePath);
  if (original.sizeBytes < 1 || original.sizeBytes > profile.maxSourceBytes || original.mediaType !== parameters.sourceMimeType) return invalid();
  signal?.throwIfAborted();
  // Runtime owns decoding and the frame basis. These unary preparations cannot
  // be interrupted by the App; cancellation abandons submission when they settle.
  const preparedSource = await client.ai.artifacts.upload({ source: { kind: 'app-asset', relativePath: original.relativePath },
    mimeType: parameters.sourceMimeType, audioPreparation: { profile: 'canonical-pcm-v1' } });
  signal?.throwIfAborted();
  const sourceInfo = preparedSource.audioInfo;
  if (!sourceInfo || preparedSource.mimeType !== 'audio/wav' || sourceInfo.frameCount / sourceInfo.sampleRateHz > profile.maxSourceSeconds) return invalid();
  const sourceRangeResult = resolveRange(parameters.sourceStartSeconds, parameters.sourceEndSeconds, sourceInfo);
  if (sourceRangeResult === 'invalid') return invalid();
  const sourceRange = sourceRangeResult;
  let preparedTarget: typeof preparedSource | undefined;
  let targetRange: { startFrame: number; endFrame: number } | undefined;
  if (targetKind === 'reference-audio') {
    const originalTarget = await client.storage.assets.stat(parameters.targetRelativePath!);
    if (originalTarget.sizeBytes < 1 || originalTarget.sizeBytes > profile.maxTargetBytes || originalTarget.mediaType !== parameters.targetMimeType) return invalid();
    signal?.throwIfAborted();
    preparedTarget = await client.ai.artifacts.upload({ source: { kind: 'app-asset', relativePath: originalTarget.relativePath },
      mimeType: parameters.targetMimeType!, audioPreparation: { profile: 'canonical-pcm-v1' } });
    signal?.throwIfAborted();
    if (preparedTarget.artifactId === preparedSource.artifactId) {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('VoiceConvert.sameInput'));
    }
    const targetInfo = preparedTarget.audioInfo;
    if (!targetInfo || preparedTarget.mimeType !== 'audio/wav' || targetInfo.frameCount / targetInfo.sampleRateHz > profile.maxTargetSeconds) return invalid();
    const targetRangeResult = resolveRange(parameters.targetStartSeconds, parameters.targetEndSeconds, targetInfo);
    if (targetRangeResult === 'invalid') return invalid();
    targetRange = targetRangeResult;
  }
  const targetVoice: NimiLocalAppVoiceConvertTargetVoice = targetKind === 'reference-audio'
    ? { kind: 'reference-audio', artifactId: preparedTarget!.artifactId, ...(targetRange ? { range: targetRange } : {}) }
    : targetKind === 'preset' ? { kind: 'preset', presetVoiceId: presetVoiceId! }
    : { kind: 'voice-asset', voiceAssetId: voiceAssetId! };
  const adopted = await client.storage.assets.adoptArtifact({ artifactId: preparedSource.artifactId,
    relativePath: `studio/music/voice-convert-inputs/${crypto.randomUUID()}/source.wav`, overwrite: false });
  let adoptedTarget: typeof adopted | undefined;
  try {
    if (preparedTarget) adoptedTarget = await client.storage.assets.adoptArtifact({ artifactId: preparedTarget.artifactId,
      relativePath: `studio/music/voice-convert-inputs/${crypto.randomUUID()}/target.wav`, overwrite: false });
  } catch (cause) { await client.storage.assets.remove(adopted.relativePath); throw cause; }
  const sourceVocal: StudioManagedArtifact = { relativePath: adopted.relativePath, mediaType: adopted.mediaType,
    sizeBytes: adopted.sizeBytes, sha256: adopted.sha256, displayName: parameters.sourceName, previewSource: 'managed-asset' };
  const targetAudio: StudioManagedArtifact | undefined = adoptedTarget ? { relativePath: adoptedTarget.relativePath, mediaType: adoptedTarget.mediaType,
    sizeBytes: adoptedTarget.sizeBytes, sha256: adoptedTarget.sha256, displayName: parameters.targetName, previewSource: 'managed-asset' } : undefined;
  let clientSubmissionId: string;
  try {
    signal?.throwIfAborted();
    if (adopted.sizeBytes !== preparedSource.sizeBytes || adopted.mediaType !== preparedSource.mimeType) throw new Error('Canonical source adoption changed metadata');
    if (preparedTarget && adoptedTarget
      && (adoptedTarget.sizeBytes !== preparedTarget.sizeBytes || adoptedTarget.mediaType !== preparedTarget.mimeType)) throw new Error('Canonical target adoption changed metadata');
    clientSubmissionId = await beginMusicRecovery(client.storage, 'audio.voice.convert', sourceVocal, targetAudio);
  } catch (cause) {
    if (adoptedTarget) await client.storage.assets.remove(adoptedTarget.relativePath);
    await client.storage.assets.remove(adopted.relativePath);
    throw cause;
  }
  const api = client.ai;
  const scenarioClient = context.host.createScenarioJobClient({ ...api, scenarioJobs: { ...api.scenarioJobs,
    submit: (spec, options) => api.scenarioJobs.submit(spec, { ...options, clientSubmissionId }),
  } });
  const result = await context.host.runners.voiceConvert({ runtime: { ai: scenarioClient }, appId: context.host.appId,
    sourceVocal: { artifactId: preparedSource.artifactId, ...(sourceRange ? { range: sourceRange } : {}) },
    sourceKind: 'singing', targetVoice, ...(semitoneShift ? { semitoneShift } : {}),
    scenarioId: context.scenarioId, surfaceId: context.host.surfaceId,
    signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
  const projected = await projectStudioArtifactRunnerResult({ ...context, voiceSourceVocal: sourceVocal, voiceTargetAudio: targetAudio }, result);
  await saveMusicRecoveryResult(client.storage, clientSubmissionId, projected, 'audio.voice.convert');
  return projected;
}

function resolveRange(startSeconds: number | undefined, endSeconds: number | undefined, info: NimiLocalAppAudioInfo) {
  if (startSeconds === undefined && endSeconds === undefined) return undefined;
  const startFrame = Math.round((startSeconds ?? 0) * info.sampleRateHz);
  const endFrame = endSeconds === undefined ? info.frameCount : Math.round(endSeconds * info.sampleRateHz);
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || startFrame >= endFrame || endFrame > info.frameCount) return 'invalid';
  return { startFrame, endFrame };
}
