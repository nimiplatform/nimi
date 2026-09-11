import { runNimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
import { ExecutionMode, ScenarioType, VisionLocateGeometry, type VisionLocateResult } from '@nimiplatform/sdk/runtime/generated';
import type { NimiLocalAppVisionLocateResult } from '@nimiplatform/sdk/app';
import { createStudioScenarioJobClient, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';

function localVisionResult(result: VisionLocateResult): NimiLocalAppVisionLocateResult {
  return { imageArtifactId: result.imageArtifactId, width: result.width, height: result.height,
    locations: result.locations.map(location => {
      const label = location.label === undefined ? {} : { label: location.label };
      const geometry = location.geometry;
      if (geometry.oneofKind === 'box' && 'box' in geometry) return { type: 'box', ...geometry.box, ...label };
      if (geometry.oneofKind === 'point' && 'point' in geometry) return { type: 'point', ...geometry.point, ...label };
      throw new Error('Locate result geometry is missing');
    }),
  };
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export async function runVisionLocate(context: StudioCapabilityRuntimeContext) {
  const t = context.host.translate;
  const abortedBeforeSubmit = () => context.host.nonSuccess(context.capability, 'operation-aborted', t('VisionLocate.stoppedBeforeSubmit'));
  const images = context.input.attachments ?? [];
  const image = images[0];
  if (!context.prompt || images.length !== 1 || !image || image.kind !== 'image' || !['image/png','image/jpeg','image/webp','image/gif'].includes(image.mimeType)) {
    return context.host.nonSuccess(context.capability, 'input-invalid', t('VisionLocate.inputRequired'));
  }
  const prefix = `data:${image.mimeType};base64,`;
  if (!image.dataUrl.startsWith(prefix) || image.dataUrl.length > 4 * Math.ceil(32 * 1024 * 1024 / 3) + prefix.length) {
    return context.host.nonSuccess(context.capability, 'input-invalid', t('VisionLocate.imageTooLarge'));
  }
  if (context.input.signal?.aborted) return abortedBeforeSubmit();
  const bytes = Uint8Array.from(atob(image.dataUrl.slice(prefix.length)), char => char.charCodeAt(0));
  let upload;
  try {
    upload = await context.host.client.ai.artifacts.upload({ bytes, mimeType: image.mimeType as Parameters<typeof context.host.client.ai.artifacts.upload>[0]['mimeType'] });
  } catch (error) {
    if (context.input.signal?.aborted) return abortedBeforeSubmit();
    throw error;
  }
  if (context.input.signal?.aborted) return abortedBeforeSubmit();
  const result = await runNimiRuntimeScenarioJob({
    ai: createStudioScenarioJobClient(context),
    request: {
      head: { appId: context.host.appId, subjectUserId: '', timeoutMs: 0 }, scenarioType: ScenarioType.VISION_LOCATE, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'visionLocate', visionLocate: { imageArtifactId: upload.artifactId, query: context.prompt, geometry: context.input.parameters?.geometry === 'point' ? VisionLocateGeometry.POINT : VisionLocateGeometry.BOX } } },
      requestId: '', idempotencyKey: '', labels: {}, extensions: [],
    },
    signal: context.input.signal, abortReason: context.host.abortReason, onJobUpdate: context.input.onJobUpdate,
  });
  if (!result.visionLocate) throw new Error(t('VisionLocate.resultMissing'));
  const locate = localVisionResult(result.visionLocate);
  return {
    ok: true as const, capabilityId: context.capability.id, capabilityLabel: context.capability.label,
    message: t(locate.locations.length ? 'VisionLocate.found' : 'VisionLocate.noMatch', { count: locate.locations.length }),
    output: { kind: 'vision-locate' as const, jobId: result.job.jobId, result: locate, imagePreviewUrl: image.dataUrl },
    trace: { traceId: result.traceId },
  };
}
