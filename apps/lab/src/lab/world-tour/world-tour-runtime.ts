import type { StudioCapabilityRunInput, StudioCapabilityRunResult } from '../../ai-studio-core/runtime-types.js';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';
import { t } from '../../shell/i18n/index.js';
import { DEFAULT_MANIFEST_PATH, WORLD_BUNDLE_MIME, openWorldTourWindow } from './world-tour-shared.js';
import { isJsonObject } from '@nimiplatform/sdk/types';
import { createStudioRunHistoryRecord } from '../../ai-studio-core/history.js';
import { appendLabRunHistory } from '../lab-history-storage.js';

export const PENDING_WORLD_PATH = 'world-tour/pending.json';

async function pendingJobId(): Promise<string | null> {
  try {
    const { value } = await getLabLocalAppClient().storage.readJson(PENDING_WORLD_PATH);
    if (!isJsonObject(value) || typeof value.jobId !== 'string' || !value.jobId) throw new Error(t('WorldTour.pendingInvalid'));
    return value.jobId;
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'not-found') return null;
    throw cause;
  }
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export async function runWorldTour(input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> {
  const client = getLabLocalAppClient();
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error(t('WorldTour.promptRequired'));
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (await pendingJobId()) throw new Error(t('WorldTour.pendingExists'));
  const { job } = await client.ai.scenarioJobs.submit({
    type: 'world-generate', prompt, displayName: '',
  });
  await client.storage.writeJson(PENDING_WORLD_PATH, { jobId: job.jobId });
  const result = await finishWorldTourJob(job.jobId, input);
  await client.storage.removeJson(PENDING_WORLD_PATH);
  return result;
}

export async function resumeWorldTour(signal: AbortSignal, onPartial: (message: string) => void): Promise<StudioCapabilityRunResult> {
  const jobId = await pendingJobId();
  if (!jobId) throw new Error(t('WorldTour.noPendingWorld'));
  const createdAt = new Date().toISOString();
  const result = await finishWorldTourJob(jobId, { capabilityId: 'world.generate', prompt: '', signal, onPartial });
  await appendLabRunHistory(createStudioRunHistoryRecord({
    result, prompt: t('WorldTour.resume'), runId: `world-tour-${jobId}`, createdAt,
  }));
  await getLabLocalAppClient().storage.removeJson(PENDING_WORLD_PATH);
  return result;
}

async function finishWorldTourJob(jobId: string, input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> {
  const client = getLabLocalAppClient();
  let response;
  try { response = await client.ai.scenarioJobs.get(jobId); }
  catch (cause) {
    if (cause && typeof cause === 'object' && 'reasonCode' in cause && cause.reasonCode === 'ai-media-job-not-found') {
      await client.storage.removeJson(PENDING_WORLD_PATH);
    }
    throw cause;
  }
  let { job } = response;
  const terminal = () => ['completed', 'failed', 'canceled', 'timeout'].includes(job.status);
  const cancel = () => { void client.ai.scenarioJobs.cancel(jobId, 'user canceled').catch(() => undefined); };
  if (!terminal()) {
    const events = await client.ai.scenarioJobs.subscribe(jobId);
    input.signal?.addEventListener('abort', cancel, { once: true });
    if (input.signal?.aborted) cancel();
    try {
      for await (const event of events) {
        job = event.job;
        input.onPartial?.(t('WorldTour.generating'));
        if (terminal()) break;
      }
    } finally {
      input.signal?.removeEventListener('abort', cancel);
      await events.cancel();
    }
  }
  if (terminal() && job.status !== 'completed') await client.storage.removeJson(PENDING_WORLD_PATH);
  if (input.signal?.aborted || job.status === 'canceled') throw new DOMException('Aborted', 'AbortError');
  if (job.status !== 'completed') throw new Error(job.reasonDetail || job.reasonCode || t('WorldTour.generationFailed'));
  const bundle = job.artifacts.find((artifact) => artifact.mimeType === WORLD_BUNDLE_MIME);
  if (!bundle) throw new Error(t('WorldTour.archiveMissing'));
  const adopted = await client.storage.assets.adoptArtifact({
    artifactId: bundle.artifactId, relativePath: `world-tour/${jobId}/world.zip`, overwrite: true,
  });
  const manifestPath = `world-tour/${jobId}/world.json`;
  await client.storage.writeJson(manifestPath, { archivePath: adopted.relativePath });
  await client.storage.writeJson(DEFAULT_MANIFEST_PATH, { archivePath: adopted.relativePath });
  let message = t('WorldTour.generated');
  try { await openWorldTourWindow({ manifestPath }); }
  catch { message = t('WorldTour.savedOpenFailed'); }
  const artifact = {
    relativePath: adopted.relativePath, mediaType: adopted.mediaType ?? WORLD_BUNDLE_MIME,
    sizeBytes: adopted.sizeBytes, sha256: adopted.sha256,
    displayName: t('WorldTour.worldArchive'), previewSource: 'managed-asset' as const,
  };
  return {
    ok: true, capabilityId: input.capabilityId, capabilityLabel: t('Capabilities.worldGenerate.label'),
    message, output: { kind: 'artifacts', jobId, jobState: job.status, artifactCount: 1, artifacts: [artifact], firstArtifact: artifact },
    trace: { traceId: job.traceId },
  };
}
