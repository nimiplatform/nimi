import { beginMusicRecovery, readMusicRecovery, restoreSavedMusicResult, saveMusicRecoveryResult } from './music-recovery.js';
import type { StudioCapabilityRuntimeHandlers } from '../../ai-studio-core/runtime-dispatcher.js';
import { runVisionLocate } from './vision-runtime.js';
import {
  createStudioScenarioJobClient,
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
});

async function runImageGenerate(context: StudioCapabilityRuntimeContext) {
  if (!context.prompt) return inputRequired(context);
  const parameters = context.input.parameters as StudioImageGenerationParameters | undefined;
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
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
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
    const entry = (await readMusicRecovery(context.host.client.storage)).find((item) => item.clientSubmissionId === parameters.recoverySubmissionId);
    if (!entry) throw new Error(context.host.translate('Music.recoveryMissing'));
    const saved = restoreSavedMusicResult(entry, context.capability.label);
    if (saved) return saved;
    const found = await context.host.client.ai.scenarioJobs.lookupSubmission(entry.clientSubmissionId);
    const result = await context.host.runners.musicObserve({ runtime: { ai: createStudioScenarioJobClient(context) },
      jobId: found.job.jobId, signal: context.input.signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate });
    const projected = await projectStudioArtifactRunnerResult(context, result);
    await saveMusicRecoveryResult(context.host.client.storage, entry.clientSubmissionId, projected);
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
  const clientSubmissionId = await beginMusicRecovery(context.host.client.storage);
  const api = context.host.client.ai;
  const musicClient = context.host.createScenarioJobClient({ ...api, scenarioJobs: {
    ...api.scenarioJobs,
    submit: (spec, options) => api.scenarioJobs.submit(spec, { ...options, clientSubmissionId }),
  } });
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
    ...(context.input.signal ? { signal: context.input.signal, abortReason: context.host.abortReason } : {}),
  });
  const projected = await projectStudioArtifactRunnerResult(context, result);
  await saveMusicRecoveryResult(context.host.client.storage, clientSubmissionId, projected);
  return projected;
}

async function runVideoGenerate(context: StudioCapabilityRuntimeContext) {
  if (!context.prompt) return inputRequired(context);
  const parameters = context.input.parameters as StudioVideoGenerationParameters | undefined;
  const mode = parameters?.mode ?? 't2v';
  const result = await context.host.runners.videoGenerate({
    runtime: { ai: createStudioScenarioJobClient(context) },
    appId: context.host.appId,
    mode,
    prompt: context.prompt,
    ...(parameters?.negativePrompt !== undefined ? { negativePrompt: parameters.negativePrompt } : {}),
    ...(mode === 'i2v-reference' && parameters?.referenceArtifactId ? {
      content: [{ type: 'artifact-ref', role: 'reference-image', artifactId: parameters.referenceArtifactId }],
    } : {}),
    options: videoGenerationOptions(parameters),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
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
