/**
 * Native App media Jobs with the matching source-built SDK, Kit and Runtime.
 * Prepare the machine's model in Home first. These functions neither download
 * models nor choose provider/model IDs. See the bilingual multimodal guide.
 */
import type { NimiLocalAppClient, NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk';
import { ImageControlType } from '@nimiplatform/sdk/runtime/wire-types';

// #region configure
export async function configureLocalMedia(
  client: NimiLocalAppClient,
  capability: 'image.upscale' | 'video.upscale' | 'image.generate',
) {
  const current = await client.aiConfig.get();
  const intent: NimiPortableAppAIConfigIntent = {
    capabilityContract: capability,
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };
  // Show a revision conflict to the user; do not overwrite again automatically.
  return client.aiConfig.overwrite({
    expectedRevision: current.revision,
    capabilities: [
      ...(current.config?.capabilities ?? []).filter(item => item.capabilityContract !== capability),
      intent,
    ],
  });
}
// #endregion configure

// #region upscale
type UpscaleInput = {
  bytes: Uint8Array;
  scale: 2 | 4;
  seed?: number;
} & (
  | { type: 'image-upscale'; mimeType: 'image/png' | 'image/jpeg' }
  | { type: 'video-upscale'; mimeType: 'video/mp4' }
);

/** Save clientSubmissionId in App storage before calling this function. */
export async function submitUpscale(
  client: NimiLocalAppClient,
  clientSubmissionId: string,
  input: UpscaleInput,
) {
  const source = await client.ai.artifacts.upload({ bytes: input.bytes, mimeType: input.mimeType });
  return client.ai.scenarioJobs.submit({
    type: input.type,
    sourceArtifactId: source.artifactId,
    scale: input.scale,
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  }, { clientSubmissionId });
}
// #endregion upscale

// #region control
/** The caller supplies an already prepared 1024x1024 Canny PNG, not a raw photograph. */
export async function submitCannyImage(
  client: NimiLocalAppClient,
  clientSubmissionId: string,
  controlPng: Uint8Array,
  prompt: string,
  strength?: number,
) {
  const control = await client.ai.artifacts.upload({ bytes: controlPng, mimeType: 'image/png' });
  return client.ai.scenarioJobs.submit({
    type: 'image-generate',
    prompt,
    size: '1024x1024',
    negativePrompt: '', aspectRatio: '', quality: '', style: '',
    referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '',
    controlImage: {
      imageArtifactId: control.artifactId,
      type: ImageControlType.CANNY,
      ...(strength === undefined ? {} : { strength }),
    },
  }, { clientSubmissionId });
}
// #endregion control

// #region reference
/** Ordinary single-reference editing, for a compatible image.generate model. */
export async function submitReferenceImageEdit(
  client: NimiLocalAppClient,
  clientSubmissionId: string,
  sourcePng: Uint8Array,
  prompt: string,
) {
  const reference = await client.ai.artifacts.upload({ bytes: sourcePng, mimeType: 'image/png' });
  return client.ai.scenarioJobs.submit({
    type: 'image-generate', prompt, size: '1024x1024',
    negativePrompt: '', aspectRatio: '', quality: '', style: '',
    referenceImages: [], mask: '', responseFormat: '',
    referenceImageArtifactId: reference.artifactId,
  }, { clientSubmissionId });
}
// #endregion reference

// #region result
/** Query the original Job. Call after submission, or after reopening the App. */
export async function retainMediaResult(
  client: NimiLocalAppClient,
  jobId: string,
  relativePath: string,
  observationSignal?: AbortSignal,
) {
  for (;;) {
    observationSignal?.throwIfAborted();
    const { job, observationIssue } = await client.ai.scenarioJobs.get(jobId);
    observationSignal?.throwIfAborted();
    if (observationIssue) {
      throw Object.assign(new Error(`Could not observe Job ${jobId}; query this Job again.`), {
        jobId, observationIssue,
      });
    }
    if (job.status === 'completed') {
      const artifact = job.artifacts[0];
      if (!artifact) throw new Error(`Completed media Job ${jobId} has no artifact.`);
      // Use a new App-relative path. Keep the returned path/metadata with the project.
      // Adoption avoids loading a large output into a single renderer byte buffer.
      return client.storage.assets.adoptArtifact({
        artifactId: artifact.artifactId, relativePath, overwrite: false,
      });
    }
    if (job.status === 'failed' || job.status === 'canceled' || job.status === 'timeout') {
      throw Object.assign(new Error(`Job ${jobId} ended as ${job.status}: ${job.reasonDetail}`), {
        jobId, reasonCode: job.reasonCode,
      });
    }
    // Aborting observation stops polling; it does not cancel inference.
    await new Promise<void>(resolve => setTimeout(resolve, 1_000));
  }
}

/** Wire to an explicit user Cancel action, then observe the returned/queried status. */
export async function cancelMediaJob(client: NimiLocalAppClient, jobId: string) {
  return client.ai.scenarioJobs.cancel(jobId, 'user-requested');
}
// #endregion result
