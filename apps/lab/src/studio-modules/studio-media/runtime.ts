import { observeRuntimeImageGenerate, observeRuntimeVideoGenerate } from '@nimiplatform/kit/features/generation/runtime';
import { ScenarioType } from '@nimiplatform/sdk/runtime/generated';
import { beginStudioJobRecovery, recordedStudioScenarioJobClient, recoverStudioJobId, readStudioJobRecovery, restoreSavedStudioJobResult, saveStudioJobRecoveryResult, studioJobRecoverySignal } from '../../ai-studio-core/job-recovery.js';
import type { StudioCapabilityRuntimeHandlers } from '../../ai-studio-core/runtime-dispatcher.js';
import { runVisionLocate } from './vision-runtime.js';
import { runMusicTranscribe } from './music-transcription-runtime.js';
import { runVoiceConvert } from './voice-convert-runtime.js';
import { runAudioSeparate } from './audio-separate-runtime.js';
import {
  createStudioScenarioJobClient, recoverStudioJobAction,
  projectStudioArtifactRunnerResult,
  type StudioCapabilityRuntimeContext,
} from '../../ai-studio-core/runtime.js';
import type {
  StudioImageGenerationParameters,
  StudioMusicGenerationParameters,
  StudioVideoGenerationParameters,
} from './parameters.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export const studioMediaRuntimeHandlers: StudioCapabilityRuntimeHandlers = Object.freeze({
  'vision.locate': runVisionLocate,
  'image.generate': runImageGenerate,
  'video.generate': runVideoGenerate,
  'music.generate': runMusicGenerate,
  'music.transcribe': runMusicTranscribe,
  'audio.voice.convert': runVoiceConvert,
  'audio.separate': runAudioSeparate,
});

async function runImageGenerate(context: StudioCapabilityRuntimeContext) {
  const recovery = await recoverStudioJobAction(context, ScenarioType.IMAGE_GENERATE);
  if (recovery) {
    if (recovery.saved) return recovery.saved;
    const result = await observeRuntimeImageGenerate({ runtime: { ai: createStudioScenarioJobClient(context) }, jobId: recovery.jobId!,
      signal: context.input.observationSignal, cancelSignal: context.input.signal, abortReason: context.host.abortReason,
      onJobUpdate: context.input.onJobUpdate, onObservation: context.input.onObservation });
    return projectStudioArtifactRunnerResult(context, result);
  }
  if (!context.prompt) return inputRequired(context);
  const parameters = context.input.parameters as StudioImageGenerationParameters | undefined;
  if (parameters?.referenceImage?.trim() && parameters.referenceImageArtifactId?.trim()) {
    return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Studio.parameters.imageReferenceExclusive'));
  }
  const result = await context.host.runners.imageGenerate({
    runtime: { ai: createStudioScenarioJobClient(context) },
    appId: context.host.appId,
    prompt: context.prompt,
    ...(parameters?.negativePrompt !== undefined ? { negativePrompt: parameters.negativePrompt } : {}),
    ...(parameters?.count !== undefined ? { count: parameters.count } : {}),
    ...(parameters?.size !== undefined ? { size: parameters.size } : {}),
    ...(parameters?.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(parameters?.aspectRatio !== undefined ? { aspectRatio: parameters.aspectRatio } : {}),
    ...(parameters?.quality !== undefined ? { quality: parameters.quality } : {}),
    ...(parameters?.style !== undefined ? { style: parameters.style } : {}),
    ...(parameters?.referenceImage !== undefined ? { referenceImages: [parameters.referenceImage] } : {}),
    ...(parameters?.referenceImageArtifactId !== undefined ? { referenceImageArtifactId: parameters.referenceImageArtifactId } : {}),
    ...(parameters?.mask !== undefined ? { mask: parameters.mask } : {}),
    ...(parameters?.maskArtifactId !== undefined ? { maskArtifactId: parameters.maskArtifactId } : {}),
    ...(parameters?.complexity !== undefined ? { complexity: parameters.complexity } : {}),
    ...(parameters?.outputFormat !== undefined ? { outputFormat: parameters.outputFormat } : {}),
    ...(parameters?.markup !== undefined ? { markup: parameters.markup } : {}),
    ...(parameters?.markupArtifactId !== undefined ? { markupArtifactId: parameters.markupArtifactId } : {}),
    ...(parameters?.frameCount !== undefined ? { frameCount: parameters.frameCount } : {}),
    ...(parameters?.frameDurationMs !== undefined ? { frameDurationMs: parameters.frameDurationMs } : {}),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    observationSignal: context.input.observationSignal,
    onObservation: context.input.onObservation,
    ...(context.input.signal ? {
      signal: context.input.signal,
      abortReason: context.host.abortReason,
    } : {}),
  });
  return projectStudioArtifactRunnerResult(context, result);
}

async function runMusicGenerate(context: StudioCapabilityRuntimeContext) {
  const parameters = context.input.parameters as StudioMusicGenerationParameters | undefined;
  if (parameters?.recoverySubmissionId) {
    const entry = (await readStudioJobRecovery(context.host.client.storage)).find((item) => item.clientSubmissionId === parameters.recoverySubmissionId);
    if (!entry) throw new Error(context.host.translate('Music.recoveryMissing'));
    const saved = await restoreSavedStudioJobResult(entry, context.capability.label, 'music.generate', context.host.client.storage.assets, studioJobRecoverySignal(context.input));
    if (saved) return saved;
    const recoveredJobId = await recoverStudioJobId(context.host.client, entry, 'music.generate');
    const result = await context.host.runners.musicObserve({ runtime: { ai: createStudioScenarioJobClient(context) },
      jobId: recoveredJobId, signal: context.input.observationSignal, cancelSignal: context.input.signal, onObservation: context.input.onObservation, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
    const projected = await projectStudioArtifactRunnerResult(context, result);
    await saveStudioJobRecoveryResult(context.host.client.storage, entry.clientSubmissionId, projected);
    return projected;
  }
  const lyrics = parameters?.lyrics ?? '';
  if (!context.prompt) return inputRequired(context);
  const snapshot = await context.host.client.aiConfig.get();
  const selected = snapshot.effectiveSelections.find((item) => item.capabilityContract === 'music.generate');
  const resource = selected?.resource;
  const capabilities = resource?.oneofKind === 'local' ? resource.local.musicInput : resource?.oneofKind === 'cloud' ? resource.cloud.target?.musicInput : undefined;
  const profile = capabilities?.generation.find((item) => item.scoreMode === (parameters?.scoreRelativePath ? 'required' : 'unsupported'));
  if (selected?.state !== 'ready' || !profile) return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Music.configureInputs'));
  let score: { artifactId: string; format: 'abc' } | undefined;
  if (parameters?.scoreRelativePath) {
    const input = await context.host.client.storage.assets.read({ relativePath: parameters.scoreRelativePath });
    if (input.asset.mediaType !== 'text/vnd.abc' || input.asset.sizeBytes < 1 || input.asset.sizeBytes > profile.maxScoreBytes) throw new Error(context.host.translate('Music.scoreTooLarge'));
    const bytes = new Uint8Array(input.asset.sizeBytes);
    let offset = 0;
    for await (const chunk of input.body) {
      if (offset + chunk.byteLength > bytes.length) throw new Error(context.host.translate('Music.scoreTooLarge'));
      bytes.set(chunk, offset); offset += chunk.byteLength;
    }
    if (offset !== bytes.length) throw new Error(context.host.translate('Music.scoreIncomplete'));
    const uploaded = await context.host.client.ai.artifacts.upload({ bytes, mimeType: 'text/vnd.abc' });
    score = { artifactId: uploaded.artifactId, format: 'abc' };
  }
  // Record the author action before Submit, so a lost response remains recoverable.
  const clientSubmissionId = await beginStudioJobRecovery(context.host.client.storage, 'music.generate', undefined, undefined,
    undefined, context.input.recordedRunConfig, context.input.prompt);
  const musicClient = recordedStudioScenarioJobClient(context, clientSubmissionId, 'music.generate');
  const result = await context.host.runners.musicGenerate({
    runtime: { ai: musicClient },
    appId: context.host.appId,
    prompt: context.prompt,
    lyrics,
    ...(parameters?.durationSeconds !== undefined ? { durationSeconds: parameters.durationSeconds } : {}),
    ...(parameters?.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(parameters?.instrumental !== undefined ? { instrumental: parameters.instrumental } : {}),
    ...(parameters?.returnGeneratedScore !== undefined ? { returnGeneratedScore: parameters.returnGeneratedScore } : {}),
    ...(score ? { score, scoreConditioning: parameters?.scoreConditioning ?? 'melody-and-harmony' } : {}),
    onJobUpdate: context.input.onJobUpdate,
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    observationSignal: context.input.observationSignal,
    onObservation: context.input.onObservation,
    ...(context.input.signal ? { signal: context.input.signal, observationSignal: context.input.observationSignal, onObservation: context.input.onObservation, abortReason: context.host.abortReason } : {}),
  });
  const projected = await projectStudioArtifactRunnerResult(context, result);
  await saveStudioJobRecoveryResult(context.host.client.storage, clientSubmissionId, projected);
  return projected;
}

async function runVideoGenerate(context: StudioCapabilityRuntimeContext) {
  const recovery = await recoverStudioJobAction(context, ScenarioType.VIDEO_GENERATE);
  if (recovery) {
    if (recovery.saved) return recovery.saved;
    const result = await observeRuntimeVideoGenerate({ runtime: { ai: createStudioScenarioJobClient(context) }, jobId: recovery.jobId!,
      signal: context.input.observationSignal, cancelSignal: context.input.signal, abortReason: context.host.abortReason,
      onJobUpdate: context.input.onJobUpdate, onObservation: context.input.onObservation });
    return projectStudioArtifactRunnerResult(context, result);
  }
  const parameters = context.input.parameters as StudioVideoGenerationParameters | undefined;
  const mode = parameters?.mode ?? 't2v';
  if (!context.prompt && mode === 't2v') return inputRequired(context);
  type VideoContent = NonNullable<Parameters<typeof context.host.runners.videoGenerate>[0]['content']>[number];
  const content: VideoContent[] = [];
  if (mode === 'i2v-first-frame' || mode === 'i2v-first-last') {
    const frames = [
      { role: 'first-frame' as const, artifactId: parameters?.firstFrameArtifactId, url: parameters?.firstFrameImageUrl },
      ...(mode === 'i2v-first-last' ? [{ role: 'last-frame' as const, artifactId: parameters?.lastFrameArtifactId, url: parameters?.lastFrameImageUrl }] : []),
    ];
    for (const frame of frames) {
      if (Number(Boolean(frame.artifactId?.trim())) + Number(Boolean(frame.url?.trim())) !== 1) {
        return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate(frame.role === 'first-frame' ? 'Studio.parameters.videoFirstFrameRequired' : 'Studio.parameters.videoLastFrameRequired'));
      }
      content.push(frame.artifactId?.trim()
        ? { type: 'artifact-ref', role: frame.role, artifactId: frame.artifactId }
        : { type: 'image-url', role: frame.role, url: frame.url! });
    }
  } else if (mode === 'i2v-reference') {
    const ids = [...(parameters?.referenceArtifactId?.trim() ? [parameters.referenceArtifactId] : []), ...(parameters?.additionalReferenceArtifactIds ?? [])];
    const videos = parameters?.referenceVideoUrls ?? [];
    const audios = parameters?.referenceAudioUrls ?? [];
    const audioIds = parameters?.referenceAudioArtifactIds ?? [];
    const videoIds = parameters?.referenceVideoArtifactIds ?? [];
    if (ids.length + videos.length + audios.length + audioIds.length + videoIds.length === 0 || [...ids, ...videos, ...audios, ...audioIds, ...videoIds].some((id) => typeof id !== 'string' || !id.trim())) {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Studio.parameters.videoReferencesRequired'));
    }
    content.push(...ids.map((artifactId) => ({ type: 'artifact-ref' as const, role: 'reference-image' as const, artifactId: artifactId! })));
    content.push(...videoIds.map((artifactId) => ({ type: 'artifact-ref' as const, role: 'reference-video' as const, artifactId })));
    content.push(...videos.map((url) => ({ type: 'video-url' as const, role: 'reference-video' as const, url })));
    content.push(...audioIds.map((artifactId) => ({ type: 'artifact-ref' as const, role: 'reference-audio' as const, artifactId })));
    content.push(...audios.map((url) => ({ type: 'audio-url' as const, role: 'reference-audio' as const, url })));
  }
  const result = await context.host.runners.videoGenerate({
    runtime: { ai: createStudioScenarioJobClient(context) },
    appId: context.host.appId,
    mode,
    prompt: context.prompt,
    ...(parameters?.negativePrompt !== undefined ? { negativePrompt: parameters.negativePrompt } : {}),
    ...(content.length > 0 ? { content } : {}),
    options: videoGenerationOptions(parameters),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    observationSignal: context.input.observationSignal,
    onObservation: context.input.onObservation,
    ...(context.input.signal ? {
      signal: context.input.signal,
      abortReason: context.host.abortReason,
    } : {}),
  });
  return projectStudioArtifactRunnerResult(context, result);
}

function inputRequired(context: StudioCapabilityRuntimeContext) {
  return context.host.nonSuccess(
    context.capability,
    'input-invalid',
    `${context.capability.label} requires non-empty input.`,
  );
}

function videoGenerationOptions(parameters: StudioVideoGenerationParameters | undefined) {
  if (!parameters) return undefined;
  return {
    ...(parameters.resolution !== undefined ? { resolution: parameters.resolution } : {}),
    ...(parameters.ratio !== undefined ? { ratio: parameters.ratio } : {}),
    ...(parameters.durationSec !== undefined ? { durationSec: parameters.durationSec } : {}),
    ...(parameters.frames !== undefined ? { frames: parameters.frames } : {}),
    ...(parameters.fps !== undefined ? { fps: parameters.fps } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(parameters.cameraFixed !== undefined ? { cameraFixed: parameters.cameraFixed } : {}),
    ...(parameters.watermark !== undefined ? { watermark: parameters.watermark } : {}),
    ...(parameters.generateAudio !== undefined ? { generateAudio: parameters.generateAudio } : {}),
    ...(parameters.draft !== undefined ? { draft: parameters.draft } : {}),
    ...(parameters.serviceTier !== undefined ? { serviceTier: parameters.serviceTier } : {}),
    ...(parameters.executionExpiresAfterSec !== undefined ? { executionExpiresAfterSec: parameters.executionExpiresAfterSec } : {}),
    ...(parameters.returnLastFrame !== undefined ? { returnLastFrame: parameters.returnLastFrame } : {}),
  };
}
