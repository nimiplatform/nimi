import type { StudioCapabilityRuntimeHandlers } from '../../ai-studio-core/runtime-dispatcher.js';
import {
  createStudioScenarioJobClient,
  projectStudioArtifactRunnerResult,
  type StudioCapabilityRuntimeContext,
} from '../../ai-studio-core/runtime.js';
import type {
  StudioImageGenerationParameters,
  StudioVideoGenerationParameters,
} from './parameters.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export const studioMediaRuntimeHandlers: StudioCapabilityRuntimeHandlers = Object.freeze({
  'image.generate': runImageGenerate,
  'video.generate': runVideoGenerate,
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
