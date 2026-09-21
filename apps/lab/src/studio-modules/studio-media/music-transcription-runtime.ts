import { beginMusicRecovery, readMusicRecovery, restoreSavedMusicResult, saveMusicRecoveryResult } from './music-recovery.js';
import { createStudioScenarioJobClient, projectStudioArtifactRunnerResult, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type { StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import type { StudioMusicTranscriptionParameters } from './parameters.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
export async function runMusicTranscribe(context: StudioCapabilityRuntimeContext) {
  const parameters = context.input.parameters as StudioMusicTranscriptionParameters | undefined;
  const client = context.host.client; const signal = context.input.signal;
  if (parameters?.recoverySubmissionId) {
    const entry = (await readMusicRecovery(client.storage, 'music.transcribe')).find(item => item.clientSubmissionId === parameters.recoverySubmissionId);
    if (!entry?.sourceAudio) throw new Error(context.host.translate('Music.recoveryMissing'));
    const saved = restoreSavedMusicResult(entry, context.capability.label, 'music.transcribe');
    if (saved) return saved;
    const found = await client.ai.scenarioJobs.lookupSubmission(entry.clientSubmissionId);
    const result = await context.host.runners.musicTranscriptionObserve({ runtime: { ai: createStudioScenarioJobClient(context) },
      jobId: found.job.jobId, signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
    const projected = await projectStudioArtifactRunnerResult({ ...context, musicSourceAudio: entry.sourceAudio }, result);
    await saveMusicRecoveryResult(client.storage, entry.clientSubmissionId, projected, 'music.transcribe');
    return projected;
  }
  const invalid = () => context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Transcription.configureInputs'));
  if (!parameters?.sourceRelativePath || !parameters.sourceMimeType || !parameters.requestedFormats?.length || !parameters.requestedPart) return invalid();
  const snapshot = await client.aiConfig.get();
  const selection = snapshot.effectiveSelections.find(item => item.capabilityContract === 'music.transcribe');
  const resource = selection?.resource;
  const capabilities = resource?.oneofKind === 'local' ? resource.local.musicInput : undefined;
  const formats = parameters.requestedFormats; const part = parameters.requestedPart;
  const hasRange = parameters.startSeconds !== undefined || parameters.endSeconds !== undefined;
  const profile = capabilities?.transcription?.find(item => formats.every(format => item.formats.includes(format)) && item.parts.includes(part) && (!hasRange || item.supportsRange));
  if (selection?.state !== 'ready' || !profile) return invalid();
  const original = await client.storage.assets.stat(parameters.sourceRelativePath);
  if (original.sizeBytes < 1 || original.sizeBytes > profile.maxSourceBytes || original.mediaType !== parameters.sourceMimeType) return invalid();
  signal?.throwIfAborted();
  // Runtime owns decoding and the frame basis. This unary preparation cannot be
  // interrupted by the App; cancellation abandons submission when it settles.
  const prepared = await client.ai.artifacts.upload({ source: { kind: 'app-asset', relativePath: original.relativePath },
    mimeType: parameters.sourceMimeType, audioPreparation: { profile: 'canonical-pcm-v1' } });
  signal?.throwIfAborted();
  const info = prepared.audioInfo;
  if (!info || prepared.mimeType !== 'audio/wav' || info.frameCount / info.sampleRateHz > profile.maxDurationSeconds) return invalid();
  const startFrame = Math.round((parameters.startSeconds ?? 0) * info.sampleRateHz);
  const endFrame = parameters.endSeconds === undefined ? info.frameCount : Math.round(parameters.endSeconds * info.sampleRateHz);
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || startFrame >= endFrame || endFrame > info.frameCount) return invalid();
  const adopted = await client.storage.assets.adoptArtifact({ artifactId: prepared.artifactId,
    relativePath: `studio/music/transcription-inputs/${crypto.randomUUID()}/canonical.wav`, overwrite: false });
  const sourceAudio: StudioManagedArtifact = { relativePath: adopted.relativePath, mediaType: adopted.mediaType,
    sizeBytes: adopted.sizeBytes, sha256: adopted.sha256, displayName: parameters.sourceName, previewSource: 'managed-asset' };
  let clientSubmissionId: string;
  try {
    signal?.throwIfAborted();
    if (adopted.sizeBytes !== prepared.sizeBytes || adopted.mediaType !== prepared.mimeType) throw new Error('Canonical source adoption changed metadata');
    clientSubmissionId = await beginMusicRecovery(client.storage, 'music.transcribe', sourceAudio);
  } catch (cause) { await client.storage.assets.remove(adopted.relativePath); throw cause; }
  const api = client.ai;
  const scenarioClient = context.host.createScenarioJobClient({ ...api, scenarioJobs: { ...api.scenarioJobs,
    submit: (spec, options) => api.scenarioJobs.submit(spec, { ...options, clientSubmissionId }),
  } });
  const result = await context.host.runners.musicTranscribe({ runtime: { ai: scenarioClient }, appId: context.host.appId,
    sourceAudio: { artifactId: prepared.artifactId, ...(hasRange ? { range: { startFrame, endFrame } } : {}) },
    requestedFormats: formats, requestedParts: [part], scenarioId: context.scenarioId, surfaceId: context.host.surfaceId,
    signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
  const projected = await projectStudioArtifactRunnerResult({ ...context, musicSourceAudio: sourceAudio }, result);
  await saveMusicRecoveryResult(client.storage, clientSubmissionId, projected, 'music.transcribe');
  return projected;
}
