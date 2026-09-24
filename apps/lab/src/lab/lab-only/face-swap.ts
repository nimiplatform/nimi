import type { NimiLocalAppClient, NimiLocalAppScenarioJob } from '@nimiplatform/sdk/app';
import {
  LOCAL_ONLY_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';
import { studioRuntimeErrorMessage, type StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type {
  StudioCapabilityRunResult,
  StudioFaceSwap,
  StudioFaceSwapInput,
  StudioFaceSwapInputRole,
  StudioManagedArtifact,
} from '../../ai-studio-core/runtime-types.js';
import { studioDocumentSha256 } from '../../ai-studio-core/text-annotation-document.js';
import { labJobNonSuccess, observeLabScenarioJob } from './lab-scenario-job.js';

export type LabMediaFile = {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
};

export type LabImageFaceSwapParameters = {
  reference?: LabMediaFile;
  target?: LabMediaFile;
};

export type LabVideoFaceSwapParameters = {
  reference?: LabMediaFile;
  target?: LabMediaFile;
  noFacePolicy?: 'fail' | 'preserve-frame';
};

// The face-replacement contract admits single-frame JPEG/PNG references and
// targets, an MP4 video target, and the existing 32 MiB upload bound. Profile
// details beyond these (codec, frame rate, dimensions, audio) stay Runtime-owned
// and reach the page as its typed rejection.
export const LAB_FACE_SWAP_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export const LAB_FACE_SWAP_VIDEO_MIME_TYPE = 'video/mp4';
export const LAB_FACE_SWAP_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

function summarizeFile(file: LabMediaFile | undefined): string | undefined {
  return file ? `${file.name} · ${file.mimeType} · ${file.sizeBytes} B` : undefined;
}

export const labImageFaceSwapParameters = defineStudioParameters<LabImageFaceSwapParameters>({
  initial: () => ({}),
  routeMatrix: {
    reference: LOCAL_ONLY_STUDIO_PARAMETER,
    target: LOCAL_ONLY_STUDIO_PARAMETER,
  },
  summarize: (parameters) => ({
    ...(parameters.reference ? { reference: summarizeFile(parameters.reference) } : {}),
    ...(parameters.target ? { target: summarizeFile(parameters.target) } : {}),
  }),
  hasAlternativeInput: (parameters) => Boolean(parameters.reference && parameters.target),
});

export const labVideoFaceSwapParameters = defineStudioParameters<LabVideoFaceSwapParameters>({
  initial: () => ({}),
  routeMatrix: {
    reference: LOCAL_ONLY_STUDIO_PARAMETER,
    target: LOCAL_ONLY_STUDIO_PARAMETER,
    noFacePolicy: LOCAL_ONLY_STUDIO_PARAMETER,
  },
  summarize: (parameters) => ({
    ...(parameters.reference ? { reference: summarizeFile(parameters.reference) } : {}),
    ...(parameters.target ? { target: summarizeFile(parameters.target) } : {}),
    ...(parameters.noFacePolicy ? { noFacePolicy: parameters.noFacePolicy } : {}),
  }),
  // The no-face policy has no default; the user states it for every run.
  hasAlternativeInput: (parameters) => Boolean(parameters.reference && parameters.target && parameters.noFacePolicy),
});

export function isLabFaceSwapImage(file: Pick<LabMediaFile, 'mimeType' | 'sizeBytes'>): boolean {
  return (LAB_FACE_SWAP_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimeType)
    && file.sizeBytes > 0 && file.sizeBytes <= LAB_FACE_SWAP_MAX_UPLOAD_BYTES;
}

export function isLabFaceSwapVideo(file: Pick<LabMediaFile, 'mimeType' | 'sizeBytes'>): boolean {
  return file.mimeType === LAB_FACE_SWAP_VIDEO_MIME_TYPE
    && file.sizeBytes > 0 && file.sizeBytes <= LAB_FACE_SWAP_MAX_UPLOAD_BYTES;
}

export async function labFaceSwapInput(role: StudioFaceSwapInputRole, file: LabMediaFile): Promise<StudioFaceSwapInput> {
  return {
    role,
    name: file.name.slice(0, 255) || role,
    mediaType: file.mimeType,
    sizeBytes: file.bytes.byteLength,
    sha256: await studioDocumentSha256(file.bytes),
  };
}

type UploadMime = Parameters<NimiLocalAppClient['ai']['artifacts']['upload']>[0]['mimeType'];

export async function runLabImageFaceSwap(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const { host, capability } = context;
  const parameters = context.input.parameters as LabImageFaceSwapParameters | undefined;
  const reference = parameters?.reference;
  const target = parameters?.target;
  if (!reference || !target || !isLabFaceSwapImage(reference) || !isLabFaceSwapImage(target)) {
    return host.nonSuccess(capability, 'input-invalid', host.translate('CapabilityTests.faceSwap.imageInputInvalid'));
  }
  const inputs = [await labFaceSwapInput('reference-image', reference), await labFaceSwapInput('target-image', target)];
  const referenceArtifact = await uploadUnlessAborted(context, reference);
  const targetArtifact = referenceArtifact ? await uploadUnlessAborted(context, target) : null;
  if (!referenceArtifact || !targetArtifact) {
    return host.nonSuccess(capability, 'operation-aborted', host.translate('CapabilityTests.common.stoppedBeforeSubmit'));
  }
  const { job } = await host.client.ai.scenarioJobs.submit({
    type: 'image-face-swap',
    referenceImageArtifactId: referenceArtifact,
    targetImageArtifactId: targetArtifact,
  });
  return finishFaceSwapJob(context, job.jobId, 'image/png', { inputs });
}

export async function runLabVideoFaceSwap(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const { host, capability } = context;
  const parameters = context.input.parameters as LabVideoFaceSwapParameters | undefined;
  const reference = parameters?.reference;
  const target = parameters?.target;
  const noFacePolicy = parameters?.noFacePolicy;
  if (!reference || !target || !isLabFaceSwapImage(reference) || !isLabFaceSwapVideo(target)) {
    return host.nonSuccess(capability, 'input-invalid', host.translate('CapabilityTests.faceSwap.videoInputInvalid'));
  }
  if (noFacePolicy !== 'fail' && noFacePolicy !== 'preserve-frame') {
    return host.nonSuccess(capability, 'input-invalid', host.translate('CapabilityTests.faceSwap.policyRequired'));
  }
  const inputs = [await labFaceSwapInput('reference-image', reference), await labFaceSwapInput('target-video', target)];
  const referenceArtifact = await uploadUnlessAborted(context, reference);
  const targetArtifact = referenceArtifact ? await uploadUnlessAborted(context, target) : null;
  if (!referenceArtifact || !targetArtifact) {
    return host.nonSuccess(capability, 'operation-aborted', host.translate('CapabilityTests.common.stoppedBeforeSubmit'));
  }
  const { job } = await host.client.ai.scenarioJobs.submit({
    type: 'video-face-swap',
    referenceImageArtifactId: referenceArtifact,
    targetVideoArtifactId: targetArtifact,
    noFacePolicy,
  });
  return finishFaceSwapJob(context, job.jobId, LAB_FACE_SWAP_VIDEO_MIME_TYPE, { inputs, noFacePolicy });
}

async function uploadUnlessAborted(context: StudioCapabilityRuntimeContext, file: LabMediaFile): Promise<string | null> {
  if (context.input.signal?.aborted) return null;
  const uploaded = await context.host.client.ai.artifacts.upload({ bytes: file.bytes, mimeType: file.mimeType as UploadMime });
  return context.input.signal?.aborted ? null : uploaded.artifactId;
}

async function finishFaceSwapJob(
  context: StudioCapabilityRuntimeContext,
  jobId: string,
  outputMimeType: 'image/png' | 'video/mp4',
  faceSwap: StudioFaceSwap,
): Promise<StudioCapabilityRunResult> {
  const { host, capability } = context;
  const outcome = await observeLabScenarioJob({
    scenarioJobs: host.client.ai.scenarioJobs,
    jobId,
    capability,
    nonSuccess: host.nonSuccess,
    cancelReason: host.abortReason,
    ...(context.input.signal ? { signal: context.input.signal } : {}),
  });
  if (outcome.kind === 'non-success') return outcome.result;
  const job = outcome.job;
  const jobRef = { capability, nonSuccess: host.nonSuccess, jobId };
  const output = job.artifacts[0];
  if (job.artifacts.length !== 1 || !output || output.mimeType !== outputMimeType || !output.artifactId) {
    return labJobNonSuccess(jobRef, 'runtime-call-failed', host.translate('CapabilityTests.faceSwap.unexpectedOutput'), job).result;
  }
  const summary = outputMimeType === LAB_FACE_SWAP_VIDEO_MIME_TYPE ? job.videoFaceSwapSummary : undefined;
  if (outputMimeType === LAB_FACE_SWAP_VIDEO_MIME_TYPE
    && (!summary || summary.totalFrames !== summary.transformedFrames + summary.preservedFrames)) {
    return labJobNonSuccess(jobRef, 'runtime-call-failed', host.translate('CapabilityTests.faceSwap.summaryInvalid'), job).result;
  }
  let artifact: StudioManagedArtifact;
  try {
    artifact = await adoptFaceSwapOutput(context, job, output.artifactId);
  } catch (error) {
    return labJobNonSuccess(jobRef, 'runtime-call-failed', studioRuntimeErrorMessage(error), job).result;
  }
  return {
    ok: true,
    capabilityId: capability.id,
    capabilityLabel: capability.label,
    message: host.translate('CapabilityTests.faceSwap.completed'),
    output: {
      kind: 'artifacts',
      faceSwap: { ...faceSwap, ...(summary ? { video: summary } : {}) },
      jobId,
      jobState: job.status,
      artifactCount: 1,
      artifacts: [artifact],
      firstArtifact: artifact,
    },
    ...(job.traceId ? { trace: { traceId: job.traceId } } : {}),
  };
}

// Large results are kept through artifact adoption rather than an inline read.
async function adoptFaceSwapOutput(
  context: StudioCapabilityRuntimeContext,
  job: NimiLocalAppScenarioJob,
  artifactId: string,
): Promise<StudioManagedArtifact> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(job.jobId)));
  const token = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const adopted = await context.host.client.storage.assets.adoptArtifact({
    artifactId,
    relativePath: `media/${context.capability.id.replaceAll('.', '-')}/${token}.asset`,
    overwrite: false,
  });
  return {
    relativePath: adopted.relativePath,
    ...(adopted.mediaType ? { mediaType: adopted.mediaType } : {}),
    sizeBytes: adopted.sizeBytes,
    sha256: adopted.sha256,
    displayName: context.capability.label,
    previewSource: 'managed-asset',
  };
}
