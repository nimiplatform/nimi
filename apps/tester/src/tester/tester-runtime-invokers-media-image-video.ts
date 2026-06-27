import { buildNimiRuntimeGenerationSubmitRequest } from '@nimiplatform/sdk/features/generation';
import { runNimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
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
import { imageProfileExtensions, resolveImageRuntimeBinding } from './tester-runtime-media-bindings.js';
import { artifactsFrom, summariseArtifact, summariseJob, traceFromRuntimeOutput, type RuntimeMediaJobOutput } from './tester-runtime-invokers-media-artifacts.js';
import { ensureLocalImageEnvironmentReady } from './tester-runtime-invokers-media-environment.js';
import { imageParamsFromBinding, isUnavailable, videoParamsFromBinding } from './tester-runtime-invokers-media-params.js';
import { runtimeJobHead, runtimeJobIdentity, runtimeLabels, withRuntimeClientTimeout } from './tester-runtime-invokers-media-runtime.js';

export async function invokeImageGenerate(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('image.generate', 'Scenario prompt is empty — supply an image prompt before running image.generate.');
  }
  const resolved = resolveTesterLLMBinding('image.generate');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'image.generate', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const subjectUserId = requireRuntimeSubjectUserId('image.generate', client);
  try {
    const imageBinding = await resolveImageRuntimeBinding(client, resolved);
    const imageParams = imageParamsFromBinding(imageBinding.resolved);
    if (isUnavailable(imageParams)) return imageParams;
    const localEnvironmentUnavailable = await ensureLocalImageEnvironmentReady(client, imageBinding);
    if (localEnvironmentUnavailable) return localEnvironmentUnavailable;
    const timeoutMs = imageParams.timeoutMs ?? 120_000;
    const route = runtimeRoutePayload(imageBinding.resolved);
    const extensions = imageProfileExtensions(imageBinding, imageParams.providerOptions);
    const mediaImage = client.runtime.media?.image;
    const output = await withRuntimeClientTimeout('image.generate', timeoutMs, async (signal) => (
      mediaImage
        ? await mediaImage.generate({
          ...route,
          subjectUserId,
          prompt,
          negativePrompt: imageParams.negativePrompt,
          count: imageParams.count,
          size: imageParams.size,
          aspectRatio: imageParams.aspectRatio,
          quality: imageParams.quality,
          style: imageParams.style,
          seed: imageParams.seed,
          referenceImages: imageParams.referenceImages,
          mask: imageParams.mask,
          responseFormat: imageParams.responseFormat,
          extensions,
          timeoutMs,
          signal,
          metadata: runtimeLabels('nimi.tester.media.image.generate', imageBinding.resolved, schedulingPreflight.evidenceMetadata),
        }) as RuntimeMediaJobOutput
        : await runNimiRuntimeScenarioJob({
          ai: client.runtime.ai,
          request: buildNimiRuntimeGenerationSubmitRequest({ ...runtimeJobHead(imageBinding.resolved, subjectUserId), timeoutMs }, {
            scenario: {
              kind: 'image',
              prompt,
              negativePrompt: imageParams.negativePrompt,
              count: imageParams.count,
              size: imageParams.size,
              aspectRatio: imageParams.aspectRatio,
              quality: imageParams.quality,
              style: imageParams.style,
              seed: imageParams.seed,
              referenceImages: imageParams.referenceImages,
              mask: imageParams.mask,
              responseFormat: imageParams.responseFormat,
            },
            ...runtimeJobIdentity('image.generate', input.scenarioId),
            labels: runtimeLabels('nimi.tester.ai.image.generate', imageBinding.resolved, schedulingPreflight.evidenceMetadata),
            extensions,
          }),
          signal,
          abortReason: `tester_image_generate_timeout_${timeoutMs}ms`,
        })
    ));
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
        firstArtifact: await summariseArtifact(client, artifacts[0]),
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
  const route = runtimeRoutePayload(resolved);
  const subjectUserId = requireRuntimeSubjectUserId('video.generate', client);
  try {
    const videoParams = videoParamsFromBinding(resolved);
    if (isUnavailable(videoParams)) return videoParams;
    const timeoutMs = videoParams.timeoutMs ?? 120_000;
    const mediaVideo = client.runtime.media?.video;
    const output = await withRuntimeClientTimeout('video.generate', timeoutMs, async (signal) => (
      mediaVideo
        ? await mediaVideo.generate({
          mode: videoParams.mode,
          ...route,
          subjectUserId,
          prompt,
          negativePrompt: videoParams.negativePrompt,
          options: videoParams.options,
          content: [{ type: 'text', role: 'prompt', text: prompt }],
          timeoutMs,
          signal,
          metadata: runtimeLabels('nimi.tester.media.video.generate', resolved, schedulingPreflight.evidenceMetadata),
        }) as RuntimeMediaJobOutput
        : await runNimiRuntimeScenarioJob({
          ai: client.runtime.ai,
          request: buildNimiRuntimeGenerationSubmitRequest({ ...runtimeJobHead(resolved, subjectUserId), timeoutMs }, {
            scenario: {
              kind: 'video',
              mode: videoParams.mode,
              prompt,
              negativePrompt: videoParams.negativePrompt,
              content: [{ type: 'text', role: 'prompt', text: prompt }],
              options: videoParams.options,
            },
            ...runtimeJobIdentity('video.generate', input.scenarioId),
            labels: runtimeLabels('nimi.tester.ai.video.generate', resolved, schedulingPreflight.evidenceMetadata),
          }),
          signal,
          abortReason: `tester_video_generate_timeout_${timeoutMs}ms`,
        })
    ));
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
        firstArtifact: await summariseArtifact(client, artifacts[0]),
      },
      trace: traceFromRuntimeOutput(output),
    };
  } catch (error) {
    return unavailableFromError('video.generate', error);
  }
}
