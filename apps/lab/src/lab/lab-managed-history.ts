import type { LabImageHistoryRecord } from './lab-image-history.js';
import {
  projectStudioManagedHistory,
  studioHistoryArtifactPaths,
  type StudioHistoryMutationSubject,
  type StudioRunHistory,
} from '../ai-studio-core/index.js';

export type LabManagedHistoryOutcome = {
  readonly completed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly runHistory: StudioRunHistory;
  readonly imageHistory: readonly LabImageHistoryRecord[];
  readonly issues: readonly { readonly runId: string; readonly step: 'asset' | 'history'; readonly message: string }[];
};

export type LabManagedHistoryPort = {
  readonly loadRunHistory: () => Promise<StudioRunHistory>;
  readonly loadImageHistory: () => Promise<readonly LabImageHistoryRecord[]>;
  readonly removeAsset: (relativePath: string) => Promise<{ readonly removed: boolean }>;
  readonly removeRunHistory: (runId: string) => Promise<unknown>;
  readonly removeImageHistory: (runId: string, ids: readonly string[]) => Promise<unknown>;
  readonly loadRecoveryReferences: () => Promise<readonly LabRecoveryReference[]>;
  readonly forgetRecoveryReference: (reference: LabRecoveryReference) => Promise<void>;
  readonly projectHistory: (runHistory: StudioRunHistory, imageHistory: readonly LabImageHistoryRecord[]) => Promise<{
    readonly runHistory: StudioRunHistory; readonly imageHistory: readonly LabImageHistoryRecord[] }>;
};

export type LabRecoveryReference = {
  readonly id: string;
  readonly capabilityId: string;
  readonly jobId?: string;
  readonly complete: boolean;
  readonly artifactPaths: readonly string[];
};

const waitingReferences = new Map<string, number>();
function countReference(counts: Map<string, number>, key: string, delta: number) {
  const count = (counts.get(key) ?? 0) + delta;
  if (count) counts.set(key, count);
  else counts.delete(key);
}

let mutationTail: Promise<unknown> = Promise.resolve();
/** Same-renderer compound commits serialize here; leaf JSON writers retain
 * their own queues. No operation re-enters this queue while holding it. */
export function withLabManagedHistoryOperation<T>(operation: () => Promise<T>, references: readonly string[] = []): Promise<T> {
  for (const path of references) countReference(waitingReferences, path, 1);
  const result = mutationTail.then(operation, operation).finally(() => {
    for (const path of references) countReference(waitingReferences, path, -1);
  });
  mutationTail = result.catch(() => undefined);
  return result;
}

export async function reconcileLabManagedHistoryProjection(
  runHistory: StudioRunHistory,
  imageHistory: readonly LabImageHistoryRecord[],
  statAsset: (relativePath: string) => Promise<{ readonly sha256: string; readonly sizeBytes: number }>,
): Promise<{ readonly runHistory: StudioRunHistory; readonly imageHistory: readonly LabImageHistoryRecord[] }> {
  const projection = await projectStudioManagedHistory({
    runHistory,
    existingMediaHistory: imageHistory,
    retainUnprojectedMedia: true,
    statArtifact: (artifact) => statAsset(artifact.relativePath),
  });
  return { runHistory: projection.runHistory, imageHistory: projection.mediaHistory };
}

export async function deleteLabManagedHistoryRecord(
  port: LabManagedHistoryPort,
  runId: string,
  deleteAsset: boolean,
): Promise<LabManagedHistoryOutcome> {
  return withLabManagedHistoryOperation(() => mutateCapturedHistory(port, subject => subject.id === runId, deleteAsset, 1));
}

export async function clearLabManagedHistoryScope(
  port: LabManagedHistoryPort,
  capabilityId: string | null,
  deleteAssets: boolean,
): Promise<LabManagedHistoryOutcome> {
  return withLabManagedHistoryOperation(() => mutateCapturedHistory(port,
    subject => capabilityId === null || subject.capabilityId === capabilityId, deleteAssets, 0));
}

type ManagedSubject = StudioHistoryMutationSubject & { readonly jobId?: string };
async function mutateCapturedHistory(port: LabManagedHistoryPort, select: (subject: ManagedSubject) => boolean,
  deleteAssets: boolean, emptySkipped: number): Promise<LabManagedHistoryOutcome> {
  // This one snapshot after queue acquisition is the clear's linearization
  // point. Later saves wait and are never included by a fresh scope-clear.
  const [runs, media, recovery] = await Promise.all([port.loadRunHistory(), port.loadImageHistory(), port.loadRecoveryReferences()]);
  const mediaByRun = new Map<string, LabImageHistoryRecord[]>();
  for (const row of media) {
    const id = row.runId || row.id;
    const rows = mediaByRun.get(id);
    if (rows) rows.push(row);
    else mediaByRun.set(id, [row]);
  }
  const records = new Map(Object.values(runs).flat().map(record => [record.id, record]));
  const targets: ManagedSubject[] = [];
  const uses = new Map<string, number>();
  const jobs = new Map<string, number>();
  const jobKey = (item: { capabilityId: string; jobId?: string }) => JSON.stringify([item.capabilityId, item.jobId]);
  const recoveryByJob = new Map<string, LabRecoveryReference[]>();
  for (const item of recovery) {
    for (const path of new Set(item.artifactPaths)) countReference(uses, path, 1);
    if (!item.complete || !item.jobId) continue;
    const key = jobKey(item);
    const items = recoveryByJob.get(key);
    if (items) items.push(item);
    else recoveryByJob.set(key, [item]);
  }
  for (const id of new Set([...records.keys(), ...mediaByRun.keys()])) {
    const record = records.get(id);
    const rows = mediaByRun.get(id) ?? [];
    const capabilityId = record?.capabilityId ?? rows[0]!.capabilityId;
    if (rows.some(row => row.capabilityId !== capabilityId)) throw new Error('Lab media history has conflicting capability ownership');
    const jobIds = new Set(rows.map(row => row.jobId).filter(Boolean));
    if (record?.result?.ok && 'jobId' in record.result) jobIds.add(record.result.jobId);
    if (jobIds.size > 1) throw new Error('Lab media result has conflicting job identities');
    const jobId = [...jobIds][0];
    const paths = new Set(record ? studioHistoryArtifactPaths(record) : []);
    for (const row of rows) if (row.relativePath) paths.add(row.relativePath);
    const subject = { id, capabilityId, jobId, artifactPaths: [...paths].sort((a,b) => a.localeCompare(b)) };
    for (const path of paths) countReference(uses, path, 1);
    if (jobId) countReference(jobs, jobKey(subject), 1);
    if (select(subject)) targets.push(subject);
  }
  let completed = 0, skipped = 0, failed = 0;
  const issues: { runId: string; step: 'asset' | 'history'; message: string }[] = [];
  for (const target of targets) {
    const key = jobKey(target);
    const related = target.jobId && jobs.get(key) === 1 ? recoveryByJob.get(key) ?? [] : [];
    const removing = new Map<string, number>();
    for (const path of target.artifactPaths) countReference(removing, path, 1);
    for (const item of related) for (const path of new Set(item.artifactPaths)) countReference(removing, path, 1);
    const assetFailures: string[] = [];
    if (deleteAssets) for (const [path, count] of removing) {
      if (uses.get(path) !== count || waitingReferences.has(path)) continue;
      try { await port.removeAsset(path); }
      catch (error) { assetFailures.push(`${path}: ${String(error)}`); }
    }
    if (assetFailures.length) {
      // Keep full source/output references for an exact retry. Saved recovery
      // must validate custody before opening, so partial deletion is not ok.
      skipped += 1; issues.push({ runId: target.id, step: 'asset', message: assetFailures.join('; ') }); continue;
    }
    try {
      for (const item of related) {
        await port.forgetRecoveryReference(item);
        for (const path of new Set(item.artifactPaths)) countReference(uses, path, -1);
      }
      // Run is last: if either earlier index fails, it retains every reference
      // needed by retry. Never erase newly appended records by capability.
      await port.removeImageHistory(target.id, (mediaByRun.get(target.id) ?? []).map(row => row.id));
      await port.removeRunHistory(target.id);
      if (target.jobId) countReference(jobs, key, -1);
      for (const path of target.artifactPaths) countReference(uses, path, -1);
      completed += 1;
    } catch (error) { failed += 1; issues.push({ runId: target.id, step: 'history', message: String(error) }); }
  }
  const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const projection = await port.projectHistory(runHistory, imageHistory);
  return { completed, skipped: skipped + (targets.length ? 0 : emptySkipped), failed, ...projection, issues };
}
