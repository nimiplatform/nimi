import type { NimiLocalAppClient, NimiLocalAppScenarioJob, NimiVideoSessionResult } from '@nimiplatform/sdk/app';

type ImageInput = { readonly bytes: Uint8Array; readonly mimeType: 'image/png' | 'image/jpeg' };

// The caller supplies its already admitted formal App client. Resource
// selection remains in App AIConfig and the machine's selected Loadout.
async function completedJob(client: NimiLocalAppClient, job: NimiLocalAppScenarioJob) {
  const events = await client.ai.scenarioJobs.subscribe(job.jobId);
  try {
    for await (const event of events) {
      job = event.job;
      if (job.status === 'completed') return job;
      if (job.status === 'failed' || job.status === 'canceled' || job.status === 'timeout') {
        throw new Error(`${job.reasonCode}: ${job.reasonDetail}`);
      }
    }
    throw new Error('The Job event stream ended before a terminal result.');
  } finally { events.cancel(); }
}

export async function imageFaceReplacement(client: NimiLocalAppClient, reference: ImageInput, target: ImageInput) {
  const referenceArtifact = await client.ai.artifacts.upload(reference);
  const targetArtifact = await client.ai.artifacts.upload(target);
  const submitted = await client.ai.scenarioJobs.submit({ type: 'image-face-swap', referenceImageArtifactId: referenceArtifact.artifactId, targetImageArtifactId: targetArtifact.artifactId });
  const job = await completedJob(client, submitted.job);
  return { job, image: await client.ai.artifacts.read(job.artifacts[0]!.artifactId) };
}

export async function videoFaceReplacement(client: NimiLocalAppClient, reference: ImageInput, video: Uint8Array, noFacePolicy: 'fail' | 'preserve-frame', destination: string) {
  const referenceArtifact = await client.ai.artifacts.upload(reference);
  const videoArtifact = await client.ai.artifacts.upload({ bytes: video, mimeType: 'video/mp4' });
  const submitted = await client.ai.scenarioJobs.submit({ type: 'video-face-swap', referenceImageArtifactId: referenceArtifact.artifactId, targetVideoArtifactId: videoArtifact.artifactId, noFacePolicy });
  const job = await completedJob(client, submitted.job);
  // Adoption supports full results above the inline 32-MiB read ceiling.
  const asset = await client.storage.assets.adoptArtifact({ artifactId: job.artifacts[0]!.artifactId, relativePath: destination, overwrite: true });
  return { job, asset, video: await client.storage.assets.read({ relativePath: asset.relativePath }) };
}

export async function* videoFrameReplacement(client: NimiLocalAppClient, reference: ImageInput, frames: AsyncIterable<{ readonly frame: Uint8Array; readonly timestampUs: string }>): AsyncGenerator<NimiVideoSessionResult> {
  const referenceArtifact = await client.ai.artifacts.upload(reference);
  const opened = await client.ai.videoSessions.open({ referenceImageArtifactId: referenceArtifact.artifactId, format: { width: 1280, height: 720, pixelFormat: 'rgb8' } });
  const scope = { videoSessionId: opened.videoSessionId, generation: opened.generation };
  let sequence = 0n;
  try {
    for await (const input of frames) {
      await client.ai.videoSessions.submitFrame({ ...scope, sequence: String(++sequence), timestampUs: input.timestampUs, frame: input.frame });
      let result: NimiVideoSessionResult | null;
      do { result = await client.ai.videoSessions.read(scope); } while (result === null);
      yield result;
      if (result.type === 'session-terminal') return;
    }
  } finally { await client.ai.videoSessions.close(scope); }
}
