import { ScenarioType } from '@nimiplatform/sdk/runtime/generated';
import { LOCAL_ONLY_STUDIO_PARAMETER, defineStudioParameters } from '../../ai-studio-core/parameters.js';
import { adoptStudioJobArtifact, managedStudioAssetPath, recoverStudioJobAction, submitStudioLocalJob, studioRuntimeErrorMessage, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type { StudioCapabilityRunResult, StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import type { LabMediaFile } from './face-swap.js';
import { labJobNonSuccess, observeLabScenarioJob } from './lab-scenario-job.js';

export type LabUpscaleParameters = {
  source?: LabMediaFile;
  scale: 2 | 4;
  seed?: number;
};

export const labUpscaleParameters = defineStudioParameters<LabUpscaleParameters>({
  initial: () => ({ scale: 2 }),
  routeMatrix: { source: LOCAL_ONLY_STUDIO_PARAMETER, scale: LOCAL_ONLY_STUDIO_PARAMETER, seed: LOCAL_ONLY_STUDIO_PARAMETER },
  summarize: ({ source, scale, seed }) => ({
    ...(source ? { source: `${source.name} · ${source.mimeType} · ${source.sizeBytes} B` } : {}),
    scale: String(scale),
    ...(seed === undefined ? {} : { seed: String(seed) }),
  }),
  hasAlternativeInput: (parameters) => Boolean(parameters.source),
});

export function isLabUpscaleSource(file: LabMediaFile, video: boolean): boolean {
  return file.sizeBytes > 0 && file.sizeBytes <= 32 * 1024 * 1024
    && (video ? file.mimeType === 'video/mp4' : file.mimeType === 'image/png' || file.mimeType === 'image/jpeg');
}

export async function runLabUpscale(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const video = context.capability.id === 'video.upscale';
  const scenarioType = video ? ScenarioType.VIDEO_UPSCALE : ScenarioType.IMAGE_UPSCALE;
  const recovery = await recoverStudioJobAction(context, scenarioType);
  if (recovery?.saved) return recovery.saved;
  let jobId = recovery?.jobId;
  if (!jobId) {
    const parameters = context.input.parameters as LabUpscaleParameters | undefined;
    const source = parameters?.source;
    if (!source || !isLabUpscaleSource(source, video) || (parameters.scale !== 2 && parameters.scale !== 4)
      || (parameters.seed !== undefined && (!Number.isInteger(parameters.seed) || parameters.seed < 0 || parameters.seed > 2147483647))) {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('CapabilityTests.upscale.invalidInput'));
    }
    const uploaded = await context.host.client.ai.artifacts.upload({
      bytes: source.bytes,
      mimeType: source.mimeType as 'image/png' | 'image/jpeg' | 'video/mp4',
    });
    if (context.input.signal?.aborted) {
      return context.host.nonSuccess(context.capability, 'operation-aborted', context.host.translate('CapabilityTests.common.stoppedBeforeSubmit'));
    }
    const { job } = await submitStudioLocalJob(context, {
      type: video ? 'video-upscale' : 'image-upscale', sourceArtifactId: uploaded.artifactId,
      scale: parameters.scale, ...(parameters.seed === undefined ? {} : { seed: parameters.seed }),
    }, { scenarioType });
    jobId = job.jobId;
  }
  const outcome = await observeLabScenarioJob({
    ai: context.host.client.ai, scenarioType, jobId, capability: context.capability,
    nonSuccess: context.host.nonSuccess, cancelReason: context.host.abortReason,
    signal: context.input.observationSignal, cancelSignal: context.input.signal, onObservation: context.input.onObservation,
  });
  if (outcome.kind === 'non-success') return outcome.result;
  const job = outcome.job;
  const expectedMime = video ? 'video/mp4' : 'image/png';
  const source = job.artifacts[0];
  const ref = { capability: context.capability, nonSuccess: context.host.nonSuccess, jobId };
  if (job.artifacts.length !== 1 || !source || source.mimeType !== expectedMime) {
    return labJobNonSuccess(ref, 'runtime-call-failed', context.host.translate('CapabilityTests.upscale.invalidOutput'), job).result;
  }
  let artifact: StudioManagedArtifact;
  try {
    const { asset } = await adoptStudioJobArtifact(context, source, await managedStudioAssetPath(context.capability.id, jobId, 0));
    artifact = { relativePath: asset.relativePath, mediaType: expectedMime, sizeBytes: asset.sizeBytes, sha256: asset.sha256, displayName: context.capability.label, previewSource: 'managed-asset' };
  } catch (error) {
    return labJobNonSuccess(ref, 'runtime-call-failed', studioRuntimeErrorMessage(error), job).result;
  }
  return {
    ok: true, capabilityId: context.capability.id, capabilityLabel: context.capability.label,
    message: context.host.translate('CapabilityTests.upscale.completed'),
    output: { kind: 'artifacts', jobId, jobState: job.status, artifactCount: 1, artifacts: [artifact], firstArtifact: artifact },
    ...(job.traceId ? { trace: { traceId: job.traceId } } : {}),
  };
}
