import { createNimiAppRecordStore } from '@nimiplatform/kit/core/app-record-storage';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { NimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
import { withLabManagedHistoryOperation } from '../lab-managed-history.js';
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

export const WORLD_TOUR_RECOVERY_PREFIX = 'studio/recovery/world.generate';
type WorldRecoveryAssets = Pick<NimiLocalAppClient['storage']['assets'], 'list' | 'read' | 'write' | 'remove'>;

export type WorldPendingRequest = {
  readonly prompt: string;
  readonly generationPrompt: string;
  readonly createdAt: string;
  readonly runConfig: StudioRunConfigSnapshot;
  readonly inputMode: WorldInputMode;
  readonly source?: StudioManagedArtifact;
};

export type PendingWorldState = 'pending' | 'acknowledged' | 'rejected';

export type PendingWorld = {
  readonly version: 2;
  readonly id: string;
  readonly state: PendingWorldState;
  readonly clientSubmissionId: string;
  readonly jobId?: string;
  readonly request: WorldPendingRequest;
};


function worldRecordPath(id: string): string {
  return `${WORLD_TOUR_RECOVERY_PREFIX}/${encodeURIComponent(id)}.json`;
}

export function parsePendingWorld(value: unknown): PendingWorld {
  if (
    !isJsonObject(value)
    || value.version !== 2
    || typeof value.clientSubmissionId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.clientSubmissionId)
    || value.id !== value.clientSubmissionId
    || !['pending', 'acknowledged', 'rejected'].includes(String(value.state))
    || !isJsonObject(value.request)
    || typeof value.request.prompt !== 'string'
    || typeof value.request.generationPrompt !== 'string'
    || typeof value.request.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.request.createdAt))
    || !['text', 'ordinary', 'equirectangular-360'].includes(String(value.request.inputMode))
    || !isJsonObject(value.request.runConfig)
    || (value.jobId !== undefined && (typeof value.jobId !== 'string' || !value.jobId))
  ) {
    throw new Error(t('WorldTour.pendingInvalid'));
  }
  const state = value.state as PendingWorldState;
  if ((state === 'pending' || state === 'rejected') && value.jobId !== undefined) {
    throw new Error(t('WorldTour.pendingInvalid'));
  }
  if (state === 'acknowledged' && value.jobId === undefined) {
    throw new Error(t('WorldTour.pendingInvalid'));
  }
  validateRunConfig(value.request.runConfig, 'pending.request.runConfig');
  if (value.request.inputMode !== 'text') {
    const original = worldSource(
      isJsonObject(value.request.runConfig.target) && isJsonObject(value.request.runConfig.target.params)
        ? value.request.runConfig.target.params
        : {},
    );
    const source = value.request.source;
    if (
      !original
      || !isJsonObject(source)
      || source.relativePath !== original.relativePath
      || source.sha256 !== original.sha256
      || source.sizeBytes !== original.sizeBytes
      || source.mediaType !== original.mediaType
      || source.displayName !== original.displayName
    ) {
      throw new Error(t('WorldTour.pendingInvalid'));
    }
  }
  return value as unknown as PendingWorld;
}

function worldStore(assets: WorldRecoveryAssets = getLabLocalAppClient().storage.assets) {
  return createNimiAppRecordStore<PendingWorld>(assets, WORLD_TOUR_RECOVERY_PREFIX, parsePendingWorld);
}

async function listActivePendingWorlds(
  assets: WorldRecoveryAssets = getLabLocalAppClient().storage.assets,
): Promise<readonly { readonly record: PendingWorld; readonly sha256: string }[]> {
  const versions = await worldStore(assets).listVersions();
  return versions
    .filter((entry) => entry.record.state !== 'rejected')
    .sort((left, right) => (
      Date.parse(left.record.request.createdAt) - Date.parse(right.record.request.createdAt)
      || left.record.clientSubmissionId.localeCompare(right.record.clientSubmissionId)
    ));
}

async function pendingWorld(
  assets: WorldRecoveryAssets = getLabLocalAppClient().storage.assets,
): Promise<{ readonly record: PendingWorld; readonly sha256: string } | null> {
  const active = await listActivePendingWorlds(assets);
  return active[0] ?? null;
}

export async function worldTourRecoveryReferences(assets: WorldRecoveryAssets) {
  const active = await listActivePendingWorlds(assets);
  return active.flatMap(({ record }) => {
    if (!record.request.source) return [];
    return [{
      id: `world-tour-${record.jobId ?? record.clientSubmissionId}`,
      capabilityId: 'world.generate',
      jobId: record.jobId,
      complete: false,
      artifactPaths: [record.request.source.relativePath],
    }];
  });
}

export function isDefiniteWorldAdmissionRejection(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object' || !('reasonCode' in cause) || typeof cause.reasonCode !== 'string') return false;
  return cause.reasonCode.trim().replaceAll('-', '_').toUpperCase() === 'AI_LOCAL_ASSET_SLOT_MISSING';
}

function canonicalPendingJSON(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v)
    ? v.map(ordered)
    : isJsonObject(v)
      ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, ordered(v[key])]))
      : v;
  return JSON.stringify(ordered(value));
}

export async function clearRejectedWorldPending(
  assets: WorldRecoveryAssets,
  pending: PendingWorld,
  cause: unknown,
): Promise<{ readonly removed: boolean }> {
  if (!isDefiniteWorldAdmissionRejection(cause)) return { removed: false };
  const store = worldStore(assets);
  const current = await store.readVersion(pending.clientSubmissionId).catch(() => null);
  if (!current) return { removed: false };
  if (
    current.record.state !== 'pending'
    || current.record.jobId !== undefined
    || canonicalPendingJSON(current.record.request) !== canonicalPendingJSON(pending.request)
  ) {
    return { removed: false };
  }
  try {
    await store.write({ ...current.record, state: 'rejected' }, current.sha256);
  } catch {
    return { removed: false };
  }
  try {
    const deletion = await assets.remove(worldRecordPath(pending.clientSubmissionId));
    return { removed: deletion?.removed === true };
  } catch {
    return { removed: false };
  }
}

async function clearWorldPending(assets: WorldRecoveryAssets, pending: PendingWorld): Promise<void> {
  const store = worldStore(assets);
  const current = await store.readVersion(pending.clientSubmissionId);
  if (!current) return;
  if (canonicalPendingJSON(current.record) === canonicalPendingJSON(pending)) {
    await assets.remove(worldRecordPath(pending.clientSubmissionId));
  }
}

async function updateWorldPending(
  assets: WorldRecoveryAssets,
  pending: PendingWorld,
  next: PendingWorld,
): Promise<void> {
  const store = worldStore(assets);
  const current = await store.readVersion(pending.clientSubmissionId);
  if (
    !current
    || current.record.state === 'rejected'
    || canonicalPendingJSON(current.record) !== canonicalPendingJSON(pending)
  ) {
    throw new Error(t('WorldTour.pendingExists'));
  }
  await store.write(next, current.sha256);
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
  const assets = client.storage.assets;
  if (await pendingWorld(assets)) throw new Error(t('WorldTour.pendingExists'));
  const parameters = input.parameters ?? { inputMode: 'text' };
  const mode = String(parameters.inputMode || 'text') as WorldInputMode;
  const source = mode !== 'text' ? worldSource(parameters) : undefined;
  const prompt = input.prompt.trim();
  if (mode !== 'text' && !source) throw new Error(t('WorldTour.sourceRequired'));
  if (mode === 'text' && !prompt) throw new Error(t('WorldTour.promptRequired'));
  abortIfNeeded(input.signal);
  if (!input.recordedRunConfig) throw new Error(t('WorldTour.originalInputUnknown'));
  const request: WorldPendingRequest = JSON.parse(JSON.stringify({
    prompt: input.recordedPrompt ?? prompt,
    generationPrompt: prompt,
    createdAt: input.recordedCreatedAt ?? new Date().toISOString(),
    runConfig: input.recordedRunConfig,
    inputMode: mode,
    ...(source ? { source } : {}),
  }));
  const clientSubmissionId = crypto.randomUUID();
  const submitted: PendingWorld = parsePendingWorld({
    version: 2,
    id: clientSubmissionId,
    state: 'pending',
    clientSubmissionId,
    request,
  });
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
  input.observationSignal?.throwIfAborted();
  await worldStore(assets).write(submitted, null);
  let job;
  try {
    ({ job } = await client.ai.scenarioJobs.submit(
      { type: 'world-generate', prompt, displayName: '', ...(image ? { image } : {}) },
      { clientSubmissionId },
    ));
  } catch (cause) {
    await clearRejectedWorldPending(assets, submitted, cause);
    throw cause;
  }
  const pending: PendingWorld = {
    version: 2,
    id: clientSubmissionId,
    state: 'acknowledged',
    clientSubmissionId,
    jobId: job.jobId,
    request,
  };
  await updateWorldPending(assets, submitted, pending);
  return finishAndRecord(pending, input.observationSignal, input.onPartial, input.signal, input.onJobUpdate);
}

export function resumeWorldTour(signal: AbortSignal, onPartial: (message: string) => void, observationSignal?: AbortSignal): Promise<StudioCapabilityRunResult> {
  return withWorldOperation(() => resumeWorldTourAction(signal, onPartial, observationSignal));
}

async function resumeWorldTourAction(signal: AbortSignal, onPartial: (message: string) => void, observationSignal?: AbortSignal): Promise<StudioCapabilityRunResult> {
  const client = getLabLocalAppClient();
  const assets = client.storage.assets;
  const loaded = await pendingWorld(assets);
  if (!loaded) throw new Error(t('WorldTour.noPendingWorld'));
  let pending = loaded.record;
  if (!pending.jobId) {
    if (!pending.clientSubmissionId) throw new Error(t('WorldTour.submissionUnknown'));
    const found = await client.ai.scenarioJobs.lookupSubmission(pending.clientSubmissionId);
    const resolved: PendingWorld = { ...pending, state: 'acknowledged', jobId: found.job.jobId };
    await updateWorldPending(assets, pending, resolved);
    pending = resolved;
  }
  return finishAndRecord(pending, observationSignal, onPartial, signal);
}

async function finishAndRecord(
  pending: PendingWorld,
  signal?: AbortSignal,
  onPartial?: (message: string) => void,
  cancelSignal?: AbortSignal,
  onJobUpdate?: (job: NimiRuntimeScenarioJob) => void,
): Promise<StudioCapabilityRunResult> {
  const client = getLabLocalAppClient();
  const resultSignal = studioJobRecoverySignal({ signal: cancelSignal, observationSignal: signal });
  const jobId = pending.jobId!;
  const id = `world-tour-${jobId}`;
  const existing = (await loadLabRunHistory())['world.generate']?.find((record) => record.id === id && record.result?.ok);
  if (existing) {
    const result = restoreStudioCapabilityRunResult(existing, () => t('Capabilities.worldGenerate.label'));
    if (!result) throw new Error(t('WorldTour.pendingInvalid'));
    for (const ref of studioResultAssetReferences(existing.result)) {
      await verifyStudioManagedAsset(client.storage.assets, ref as unknown as StudioManagedArtifact, resultSignal);
    }
    resultSignal.throwIfAborted();
    await openWorldTourWindow({ manifestPath: `world-tour/${jobId}/world.json` });
    await clearWorldPending(client.storage.assets, pending);
    return { ...result, recordedHistory: existing };
  }
  const finished = await finishWorldTourJob(jobId, signal, onPartial, pending.request.source, cancelSignal, onJobUpdate);
  signal?.throwIfAborted();
  if (finished.result.ok) resultSignal.throwIfAborted();
  const record = createStudioRunHistoryRecord({
    result: finished.result,
    runId: id,
    prompt: pending.request.prompt,
    createdAt: pending.request.createdAt,
    runConfig: pending.request.runConfig,
  });
  await withLabManagedHistoryOperation(() => appendLabRunHistory(record), studioResultAssetReferences(record.result).map((ref) => String(ref.relativePath)));
  if (finished.settled) await clearWorldPending(client.storage.assets, pending);
  return { ...finished.result, recordedHistory: record };
}

async function finishWorldTourJob(
  jobId: string,
  signal?: AbortSignal,
  onPartial?: (message: string) => void,
  source?: StudioManagedArtifact,
  cancelSignal?: AbortSignal,
  onJobUpdate?: (job: NimiRuntimeScenarioJob) => void,
): Promise<{ result: StudioCapabilityRunResult; settled: boolean }> {
  const client = getLabLocalAppClient();
  const outcome = await observeLabScenarioJob({
    ai: client.ai,
    scenarioType: ScenarioType.WORLD_GENERATE,
    jobId,
    capability: labWorldTourDescriptor,
    nonSuccess: capabilityNonSuccess,
    cancelReason: 'user canceled',
    signal,
    cancelSignal,
    onJob: () => onPartial?.(t('WorldTour.generating')),
    onJobUpdate,
  });
  if (outcome.kind === 'non-success') {
    return {
      result: outcome.result,
      settled: outcome.terminal || outcome.result.diagnostics?.reasonCode === 'AI_MEDIA_JOB_NOT_FOUND',
    };
  }
  signal = studioJobRecoverySignal({ signal: cancelSignal, observationSignal: signal });
  const job = outcome.job;
  const bundle = job.artifacts.find((artifact) => artifact.mimeType === WORLD_BUNDLE_MIME);
  if (!bundle) {
    return {
      result: labJobNonSuccess({ capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, jobId }, 'runtime-call-failed', t('WorldTour.archiveMissing'), job).result,
      settled: true,
    };
  }
  abortIfNeeded(signal);
  const archivePath = `world-tour/${jobId}/world.zip`;
  let adopted;
  try {
    try { adopted = await client.storage.assets.stat(archivePath); }
    catch (cause) { if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'not-found') throw cause; }
    if (!adopted) adopted = await client.storage.assets.adoptArtifact({ artifactId: bundle.artifactId, relativePath: archivePath, overwrite: false });
    if (adopted.sizeBytes !== bundle.sizeBytes || adopted.sha256.replace(/^sha256:/u, '') !== bundle.sha256.replace(/^sha256:/u, '')) throw new Error(t('WorldTour.archiveInvalid'));
    await verifyStudioManagedAsset(client.storage.assets, adopted, signal);
  } catch (cause) {
    signal?.throwIfAborted();
    return {
      result: labJobNonSuccess({ capability: labWorldTourDescriptor, nonSuccess: capabilityNonSuccess, jobId }, 'runtime-call-failed', studioRuntimeErrorMessage(cause), job).result,
      settled: false,
    };
  }
  abortIfNeeded(signal);
  const manifestPath = `world-tour/${jobId}/world.json`;
  await client.storage.writeJson(manifestPath, { archivePath });
  await client.storage.writeJson(DEFAULT_MANIFEST_PATH, { archivePath });
  abortIfNeeded(signal);
  let message = t('WorldTour.generated');
  try { await openWorldTourWindow({ manifestPath }); } catch { message = t('WorldTour.savedOpenFailed'); }
  abortIfNeeded(signal);
  const artifact = {
    relativePath: adopted.relativePath,
    mediaType: adopted.mediaType ?? WORLD_BUNDLE_MIME,
    sizeBytes: adopted.sizeBytes,
    sha256: adopted.sha256,
    displayName: t('WorldTour.worldArchive'),
    previewSource: 'managed-asset' as const,
  };
  return {
    settled: true,
    result: {
      ok: true,
      capabilityId: 'world.generate',
      capabilityLabel: t('Capabilities.worldGenerate.label'),
      message,
      output: {
        kind: 'artifacts',
        jobId,
        jobState: job.status,
        artifactCount: 1,
        artifacts: [artifact],
        firstArtifact: artifact,
        ...(source ? { sourceImage: source } : {}),
      },
      trace: { traceId: job.traceId },
    },
  };
}
