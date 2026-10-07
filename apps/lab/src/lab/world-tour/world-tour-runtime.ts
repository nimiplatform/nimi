import type { StudioCapabilityRunInput, StudioCapabilityRunResult, StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import type { StudioRunConfigSnapshot } from '../../ai-studio-core/history.js';
import { createStudioRunHistoryRecord, restoreStudioCapabilityRunResult } from '../../ai-studio-core/history.js';
import { studioRuntimeErrorMessage } from '../../ai-studio-core/runtime.js';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';
import { t } from '../../shell/i18n/index.js';
import { DEFAULT_MANIFEST_PATH, WORLD_BUNDLE_MIME, openWorldTourWindow } from './world-tour-shared.js';
import { isJsonObject } from '@nimiplatform/sdk/types';
import { validateRunConfig } from '../../ai-studio-core/history-policy.js';
import { appendLabRunHistory, loadLabRunHistory } from '../lab-history-storage.js';
import { capabilityNonSuccess } from '../lab-non-success.js';
import { labWorldTourDescriptor } from '../lab-only/world-tour-descriptor.js';
import { labJobNonSuccess, observeLabScenarioJob } from '../lab-only/lab-scenario-job.js';
import { readWorldInput, worldSource, type WorldInputMode } from './world-tour-input.js';

export const PENDING_WORLD_PATH = 'world-tour/pending.json';
export type WorldPendingRequest = {
  readonly prompt: string; readonly generationPrompt: string; readonly createdAt: string; readonly runConfig: StudioRunConfigSnapshot;
  readonly inputMode: WorldInputMode; readonly source?: StudioManagedArtifact;
};
type PendingWorld = { readonly version: 1; readonly jobId?: string; readonly request: WorldPendingRequest };

export function parsePendingWorld(value: unknown): PendingWorld {
  if (!isJsonObject(value) || value.version !== 1 || !isJsonObject(value.request) ||
      typeof value.request.prompt !== 'string' || typeof value.request.generationPrompt !== 'string' || typeof value.request.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.request.createdAt)) ||
      !['text', 'ordinary', 'equirectangular-360'].includes(String(value.request.inputMode)) || !isJsonObject(value.request.runConfig) ||
      (value.jobId !== undefined && (typeof value.jobId !== 'string' || !value.jobId))) throw new Error(t('WorldTour.pendingInvalid'));
  validateRunConfig(value.request.runConfig, 'pending.request.runConfig');
  if (value.request.inputMode !== 'text') {
    const original = worldSource(isJsonObject(value.request.runConfig.target) && isJsonObject(value.request.runConfig.target.params) ? value.request.runConfig.target.params : {});
    const source = value.request.source;
    if (!original || !isJsonObject(source) || source.relativePath !== original.relativePath || source.sha256 !== original.sha256 ||
        source.sizeBytes !== original.sizeBytes || source.mediaType !== original.mediaType || source.displayName !== original.displayName) throw new Error(t('WorldTour.pendingInvalid'));
  }
  return value as unknown as PendingWorld;
}
async function pendingWorld(storage = getLabLocalAppClient().storage): Promise<PendingWorld | null> {
  try { return parsePendingWorld((await storage.readJson(PENDING_WORLD_PATH)).value); }
  catch (cause) { if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'not-found') return null; throw cause; }
}
export async function worldTourRecoveryReferences(storage: ReturnType<typeof getLabLocalAppClient>['storage']) {
  const pending = await pendingWorld(storage);
  if (!pending?.request.source) return [];
  return [{ id: `world-tour-${pending.jobId ?? pending.request.createdAt}`, capabilityId: 'world.generate',
    jobId: pending.jobId, complete: false, artifactPaths: [pending.request.source.relativePath] }];
}
const WORLD_ADMISSION_REJECTIONS = new Set([
  'SDK_LOCAL_APP_INPUT_INVALID', 'AI_INPUT_INVALID', 'AI_INPUT_LIMIT_EXCEEDED',
  'AI_MEDIA_SPEC_INVALID', 'AI_MEDIA_OPTION_UNSUPPORTED', 'AI_MODALITY_NOT_SUPPORTED',
  'AI_CONFIG_INVALID', 'PROTOCOL_ENVELOPE_INVALID', 'AI_ROUTE_UNSUPPORTED', 'AI_MODEL_NOT_FOUND',
  'ARTIFACT_FORBIDDEN', 'ARTIFACT_NOT_FOUND', 'ARTIFACT_MIME_MISMATCH', 'ARTIFACT_TOO_LARGE',
]);
export function isDefiniteWorldAdmissionRejection(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object' || !('reasonCode' in cause) || typeof cause.reasonCode !== 'string') return false;
  return WORLD_ADMISSION_REJECTIONS.has(cause.reasonCode.replaceAll('-', '_').toUpperCase());
}
function canonicalPendingJSON(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered)
    : isJsonObject(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, ordered(v[key])])) : v;
  return JSON.stringify(ordered(value));
}
export async function clearRejectedWorldPending(storage: Pick<ReturnType<typeof getLabLocalAppClient>['storage'], 'readJson' | 'removeJson'>,
  request: WorldPendingRequest, cause: unknown): Promise<void> {
  if (!isDefiniteWorldAdmissionRejection(cause)) return;
  let current;
  try { current = (await storage.readJson(PENDING_WORLD_PATH)).value; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'not-found') return; throw error; }
  // Clear only this exact unresolved attempt. A new request or obtained Job
  // belongs to its own observer, even if a rejection arrives later.
  if (isJsonObject(current) && current.version === 1 && current.jobId === undefined &&
      canonicalPendingJSON(current.request) === canonicalPendingJSON(request)) await storage.removeJson(PENDING_WORLD_PATH);
}
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); }

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export async function runWorldTour(input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> {
  const client = getLabLocalAppClient();
  if (await pendingWorld()) throw new Error(t('WorldTour.pendingExists'));
  const parameters = input.parameters ?? { inputMode: 'text' };
  const mode = String(parameters.inputMode || 'text') as WorldInputMode;
  const source = mode !== 'text' ? worldSource(parameters) : undefined;
  const prompt = input.prompt.trim();
  if (mode !== 'text' && !source) throw new Error(t('WorldTour.sourceRequired'));
  if (mode === 'text' && !prompt) throw new Error(t('WorldTour.promptRequired'));
  abortIfNeeded(input.signal);
  if (!input.recordedRunConfig) throw new Error(t('WorldTour.originalInputUnknown'));
  const request: WorldPendingRequest = JSON.parse(JSON.stringify({ prompt: input.recordedPrompt ?? prompt, generationPrompt: prompt,
    createdAt: input.recordedCreatedAt ?? new Date().toISOString(), runConfig: input.recordedRunConfig,
    inputMode: mode, ...(source ? { source } : {}),
  }));
  parsePendingWorld({ version: 1, request });
  let image;
  if (source) {
    const bytes = await readWorldInput(source);
    abortIfNeeded(input.signal);
    const uploaded = await client.ai.artifacts.upload({ bytes, mimeType: source.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' });
    if (uploaded.sizeBytes !== source.sizeBytes || uploaded.mimeType !== source.mediaType) throw new Error(t('WorldTour.sourceUnavailable'));
    image = { artifactId: uploaded.artifactId, projection: mode as 'ordinary' | 'equirectangular-360' };
  }
  abortIfNeeded(input.signal);
  // A lost Submit receipt must not silently replay a paid generation. Keep the
  // original request even when its Runtime Job identity is not yet known.
  await client.storage.writeJson(PENDING_WORLD_PATH, JSON.parse(JSON.stringify({ version: 1, request })));
  let job;
  try { ({ job } = await client.ai.scenarioJobs.submit({ type: 'world-generate', prompt, displayName: '', ...(image ? { image } : {}) })); }
  catch (cause) {
    await clearRejectedWorldPending(client.storage, request, cause);
    throw cause;
  }
  const pending: PendingWorld = { version: 1, jobId: job.jobId, request };
  await client.storage.writeJson(PENDING_WORLD_PATH, JSON.parse(JSON.stringify(pending)));
  return finishAndRecord(pending, input.signal, input.onPartial);
}

export async function resumeWorldTour(signal: AbortSignal, onPartial: (message: string) => void): Promise<StudioCapabilityRunResult> {
  const pending = await pendingWorld();
  if (!pending) throw new Error(t('WorldTour.noPendingWorld'));
  if (!pending.jobId) throw new Error(t('WorldTour.submissionUnknown'));
  return finishAndRecord(pending, signal, onPartial);
}

async function finishAndRecord(pending: PendingWorld, signal?: AbortSignal, onPartial?: (message: string) => void): Promise<StudioCapabilityRunResult> {
  const jobId = pending.jobId!; const id = `world-tour-${jobId}`;
  const existing = (await loadLabRunHistory())['world.generate']?.find(record => record.id === id && record.result?.ok);
  if (existing) {
    const result = restoreStudioCapabilityRunResult(existing, () => t('Capabilities.worldGenerate.label'));
    if (!result) throw new Error(t('WorldTour.pendingInvalid'));
    await openWorldTourWindow({ manifestPath: `world-tour/${jobId}/world.json` });
    await getLabLocalAppClient().storage.removeJson(PENDING_WORLD_PATH);
    return { ...result, recordedHistory: existing };
  }
  const finished = await finishWorldTourJob(jobId, signal, onPartial, pending.request.source);
  const record = createStudioRunHistoryRecord({ result: finished.result, runId: id, prompt: pending.request.prompt,
    createdAt: pending.request.createdAt, runConfig: pending.request.runConfig });
  await appendLabRunHistory(record);
  if (finished.settled) await getLabLocalAppClient().storage.removeJson(PENDING_WORLD_PATH);
  return { ...finished.result, recordedHistory: record };
}

async function finishWorldTourJob(jobId: string, signal?: AbortSignal, onPartial?: (message: string) => void, source?: StudioManagedArtifact): Promise<{ result: StudioCapabilityRunResult; settled: boolean }> {
  const client = getLabLocalAppClient();
  const outcome = await observeLabScenarioJob({ scenarioJobs: client.ai.scenarioJobs, jobId,
    capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, cancelReason: 'user canceled',
    ...(signal ? { signal } : {}), onJob: () => onPartial?.(t('WorldTour.generating')),
  });
  if (outcome.kind === 'non-success') return { result: outcome.result,
    settled: outcome.terminal || outcome.result.diagnostics?.reasonCode === 'AI_MEDIA_JOB_NOT_FOUND' };
  const job = outcome.job;
  const bundle = job.artifacts.find(artifact => artifact.mimeType === WORLD_BUNDLE_MIME);
  if (!bundle) return { result: labJobNonSuccess({ capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, jobId }, 'runtime-call-failed', t('WorldTour.archiveMissing'), job).result, settled: true };
  abortIfNeeded(signal);
  const archivePath = `world-tour/${jobId}/world.zip`;
  let adopted;
  try {
    try { adopted = await client.storage.assets.stat(archivePath); }
    catch (cause) { if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'not-found') throw cause; }
    if (!adopted) adopted = await client.storage.assets.adoptArtifact({ artifactId: bundle.artifactId, relativePath: archivePath, overwrite: false });
    if (adopted.sizeBytes !== bundle.sizeBytes || adopted.sha256.replace(/^sha256:/u, '') !== bundle.sha256.replace(/^sha256:/u, '')) throw new Error(t('WorldTour.archiveInvalid'));
  } catch (cause) { return { result: labJobNonSuccess({ capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, jobId }, 'runtime-call-failed', studioRuntimeErrorMessage(cause), job).result, settled: false }; }
  abortIfNeeded(signal);
  const manifestPath = `world-tour/${jobId}/world.json`;
  await client.storage.writeJson(manifestPath, { archivePath });
  await client.storage.writeJson(DEFAULT_MANIFEST_PATH, { archivePath });
  abortIfNeeded(signal);
  let message = t('WorldTour.generated');
  try { await openWorldTourWindow({ manifestPath }); } catch { message = t('WorldTour.savedOpenFailed'); }
  abortIfNeeded(signal);
  const artifact = { relativePath: adopted.relativePath, mediaType: adopted.mediaType ?? WORLD_BUNDLE_MIME,
    sizeBytes: adopted.sizeBytes, sha256: adopted.sha256, displayName: t('WorldTour.worldArchive'), previewSource: 'managed-asset' as const };
  return { settled: true, result: { ok: true, capabilityId: 'world.generate', capabilityLabel: t('Capabilities.worldGenerate.label'), message,
    output: { kind: 'artifacts', jobId, jobState: job.status, artifactCount: 1, artifacts: [artifact], firstArtifact: artifact, ...(source ? { sourceImage: source } : {}) },
    trace: { traceId: job.traceId } } };
}
