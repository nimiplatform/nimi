import { studioJobRecoverySignal } from '../../ai-studio-core/job-recovery.js';
import { verifyStudioManagedAsset, studioResultAssetReferences } from '../../ai-studio-core/managed-result-references.js';
import { ScenarioType } from '@nimiplatform/sdk/runtime/generated';
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
type PendingWorld = { readonly version: 1; readonly clientSubmissionId?: string; readonly jobId?: string; readonly request: WorldPendingRequest };

export function parsePendingWorld(value: unknown): PendingWorld {
  if (!isJsonObject(value) || value.version !== 1 || !isJsonObject(value.request) ||
      typeof value.request.prompt !== 'string' || typeof value.request.generationPrompt !== 'string' || typeof value.request.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.request.createdAt)) ||
      !['text', 'ordinary', 'equirectangular-360'].includes(String(value.request.inputMode)) || !isJsonObject(value.request.runConfig) ||
      (value.jobId !== undefined && (typeof value.jobId !== 'string' || !value.jobId))) throw new Error(t('WorldTour.pendingInvalid'));
  if (value.clientSubmissionId !== undefined && (typeof value.clientSubmissionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.clientSubmissionId))) throw new Error(t('WorldTour.pendingInvalid'));
  validateRunConfig(value.request.runConfig, 'pending.request.runConfig');
  if (value.request.inputMode !== 'text') {
    const original = worldSource(isJsonObject(value.request.runConfig.target) && isJsonObject(value.request.runConfig.target.params) ? value.request.runConfig.target.params : {});
    const source = value.request.source;
    if (!original || !isJsonObject(source) || source.relativePath !== original.relativePath || source.sha256 !== original.sha256 ||
        source.sizeBytes !== original.sizeBytes || source.mediaType !== original.mediaType || source.displayName !== original.displayName) throw new Error(t('WorldTour.pendingInvalid'));
  }
  return value as unknown as PendingWorld;
}
async function pendingWorld(storage: Pick<ReturnType<typeof getLabLocalAppClient>['storage'], 'readJson'> = getLabLocalAppClient().storage): Promise<PendingWorld | null> {
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
  pending: PendingWorld, cause: unknown): Promise<void> {
  if (!isDefiniteWorldAdmissionRejection(cause)) return;
  await clearWorldPending(storage, pending);
}

async function clearWorldPending(storage: Pick<ReturnType<typeof getLabLocalAppClient>['storage'], 'readJson' | 'removeJson'>, pending: PendingWorld): Promise<void> {
  const current = await pendingWorld(storage);
  if (current && canonicalPendingJSON(current) === canonicalPendingJSON(pending)) await storage.removeJson(PENDING_WORLD_PATH);
}

async function updateWorldPending(pending: PendingWorld, next: PendingWorld): Promise<void> {
  const storage = getLabLocalAppClient().storage;
  const current = await pendingWorld(storage);
  if (!current || canonicalPendingJSON(current) !== canonicalPendingJSON(pending)) throw new Error(t('WorldTour.pendingExists'));
  await storage.writeJson(PENDING_WORLD_PATH, JSON.parse(JSON.stringify(next)));
}

// This renderer owns one World pending slot and one active run/resume. Reject
// duplicate operations rather than letting two copies of A finalize around B.
let worldOperationActive = false;
async function withWorldOperation(work: () => Promise<StudioCapabilityRunResult>): Promise<StudioCapabilityRunResult> {
  if (worldOperationActive) throw new Error(t('WorldTour.pendingExists'));
  worldOperationActive = true;
  try { return await work(); }
  finally { worldOperationActive = false; }
}
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); }

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export function runWorldTour(input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> {
  return withWorldOperation(() => runWorldTourAction(input));
}

async function runWorldTourAction(input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> {
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
  const clientSubmissionId = crypto.randomUUID();
  input.observationSignal?.throwIfAborted();
  const submitted: PendingWorld = { version: 1, clientSubmissionId, request };
  await client.storage.writeJson(PENDING_WORLD_PATH, JSON.parse(JSON.stringify(submitted)));
  let job;
  try { ({ job } = await client.ai.scenarioJobs.submit({ type: 'world-generate', prompt, displayName: '', ...(image ? { image } : {}) }, { clientSubmissionId })); }
  catch (cause) {
    await clearRejectedWorldPending(client.storage, submitted, cause);
    throw cause;
  }
  const pending: PendingWorld = { version: 1, clientSubmissionId, jobId: job.jobId, request };
  await updateWorldPending(submitted, pending);
  return finishAndRecord(pending, input.observationSignal, input.onPartial, input.signal);
}

export function resumeWorldTour(signal: AbortSignal, onPartial: (message: string) => void, observationSignal?: AbortSignal): Promise<StudioCapabilityRunResult> {
  return withWorldOperation(() => resumeWorldTourAction(signal, onPartial, observationSignal));
}

async function resumeWorldTourAction(signal: AbortSignal, onPartial: (message: string) => void, observationSignal?: AbortSignal): Promise<StudioCapabilityRunResult> {
  let pending = await pendingWorld();
  if (!pending) throw new Error(t('WorldTour.noPendingWorld'));
  if (!pending.jobId) {
    if (!pending.clientSubmissionId) throw new Error(t('WorldTour.submissionUnknown'));
    const found = await getLabLocalAppClient().ai.scenarioJobs.lookupSubmission(pending.clientSubmissionId);
    const resolved = { ...pending, jobId: found.job.jobId };
    await updateWorldPending(pending, resolved);
    pending = resolved;
  }
  return finishAndRecord(pending, observationSignal, onPartial, signal);
}

async function finishAndRecord(pending: PendingWorld, signal?: AbortSignal, onPartial?: (message: string) => void, cancelSignal?: AbortSignal): Promise<StudioCapabilityRunResult> {
  const resultSignal = studioJobRecoverySignal({ signal: cancelSignal, observationSignal: signal });
  const jobId = pending.jobId!; const id = `world-tour-${jobId}`;
  const existing = (await loadLabRunHistory())['world.generate']?.find(record => record.id === id && record.result?.ok);
  if (existing) {
    const result = restoreStudioCapabilityRunResult(existing, () => t('Capabilities.worldGenerate.label'));
    if (!result) throw new Error(t('WorldTour.pendingInvalid'));
    for (const ref of studioResultAssetReferences(existing.result)) {
      await verifyStudioManagedAsset(getLabLocalAppClient().storage.assets, ref as unknown as StudioManagedArtifact, resultSignal);
    }
    resultSignal.throwIfAborted();
    await openWorldTourWindow({ manifestPath: `world-tour/${jobId}/world.json` });
    await clearWorldPending(getLabLocalAppClient().storage, pending);
    return { ...result, recordedHistory: existing };
  }
  const finished = await finishWorldTourJob(jobId, signal, onPartial, pending.request.source, cancelSignal);
  signal?.throwIfAborted();
  if (finished.result.ok) resultSignal.throwIfAborted();
  const record = createStudioRunHistoryRecord({ result: finished.result, runId: id, prompt: pending.request.prompt,
    createdAt: pending.request.createdAt, runConfig: pending.request.runConfig });
  await appendLabRunHistory(record);
  if (finished.settled) await clearWorldPending(getLabLocalAppClient().storage, pending);
  return { ...finished.result, recordedHistory: record };
}

async function finishWorldTourJob(jobId: string, signal?: AbortSignal, onPartial?: (message: string) => void, source?: StudioManagedArtifact, cancelSignal?: AbortSignal): Promise<{ result: StudioCapabilityRunResult; settled: boolean }> {
  const client = getLabLocalAppClient();
  const outcome = await observeLabScenarioJob({ ai: client.ai, scenarioType: ScenarioType.WORLD_GENERATE, jobId,
    capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, cancelReason: 'user canceled',
    signal, cancelSignal, onJob: () => onPartial?.(t('WorldTour.generating')),
  });
  if (outcome.kind === 'non-success') return { result: outcome.result,
    settled: outcome.terminal || outcome.result.diagnostics?.reasonCode === 'AI_MEDIA_JOB_NOT_FOUND' };
  signal = studioJobRecoverySignal({ signal: cancelSignal, observationSignal: signal });
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
    await verifyStudioManagedAsset(client.storage.assets, adopted, signal);
  } catch (cause) { signal?.throwIfAborted(); return { result: labJobNonSuccess({ capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, jobId }, 'runtime-call-failed', studioRuntimeErrorMessage(cause), job).result, settled: false }; }
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
