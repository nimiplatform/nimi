import type { LabImageHistoryRecord } from './lab-image-history.js';
import {
  projectStudioManagedHistory,
  studioHistoryArtifactPaths,
  type StudioHistoryMutationSubject,
  type StudioRunHistory,
  type StudioRunHistoryRecord,
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
  readonly removeRunHistory: (runId: string) => Promise<StudioRunHistory>;
  readonly removeImageHistory: (runId: string) => Promise<readonly LabImageHistoryRecord[]>;
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

let mutationTail: Promise<unknown> = Promise.resolve();
/** Same-renderer compound commits serialize here; leaf JSON writers retain
 * their own queues. No operation re-enters this queue while holding it. */
export function withLabManagedHistoryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation);
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
  const subjects: ManagedSubject[] = Object.values(runs).flat().map(record => ({
    id: record.id, capabilityId: record.capabilityId, artifactPaths: labManagedArtifactPaths(record, media),
    ...(record.result?.ok && 'jobId' in record.result ? { jobId: record.result.jobId } : {}),
  }));
  for (const subject of labMediaOnlyMutationSubjects(runs, media)) {
    const jobs = [...new Set(media.filter(row => (row.runId || row.id) === subject.id).map(row => row.jobId).filter(Boolean))];
    if (jobs.length > 1) throw new Error('Lab media result has conflicting job identities');
    subjects.push({ ...subject, ...(jobs[0] ? { jobId: jobs[0] } : {}) });
  }
  const targets = subjects.filter(select);
  const completedIds = new Set<string>();
  const forgotten = new Set<string>();
  let completed = 0, skipped = 0, failed = 0;
  const issues: { runId: string; step: 'asset' | 'history'; message: string }[] = [];
  for (const target of targets) {
    const retained = subjects.filter(other => other.id !== target.id && !completedIds.has(other.id));
    const sameJobRetained = target.jobId && retained.some(other => other.capabilityId === target.capabilityId && other.jobId === target.jobId);
    const related = sameJobRetained ? [] : recovery.filter(item => item.complete && target.jobId
      && item.capabilityId === target.capabilityId && item.jobId === target.jobId);
    const relatedIds = new Set(related.map(item => `${item.capabilityId}:${item.id}`));
    const protectedPaths = new Set([
      ...retained.flatMap(subject => subject.artifactPaths),
      ...recovery.filter(item => !relatedIds.has(`${item.capabilityId}:${item.id}`)
        && !forgotten.has(`${item.capabilityId}:${item.id}`)).flatMap(item => item.artifactPaths),
    ]);
    const paths = [...new Set([...target.artifactPaths, ...related.flatMap(item => item.artifactPaths)])];
    const assetFailures: string[] = [];
    if (deleteAssets) for (const path of paths.filter(path => !protectedPaths.has(path))) {
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
        await port.forgetRecoveryReference(item); forgotten.add(`${item.capabilityId}:${item.id}`);
      }
      // Run is last: if either earlier index fails, it retains every reference
      // needed by retry. Never erase newly appended records by capability.
      await port.removeImageHistory(target.id);
      await port.removeRunHistory(target.id);
      completedIds.add(target.id); completed += 1;
    } catch (error) { failed += 1; issues.push({ runId: target.id, step: 'history', message: String(error) }); }
  }
  const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const projection = await port.projectHistory(runHistory, imageHistory);
  return { completed, skipped: skipped + (targets.length ? 0 : emptySkipped), failed, ...projection, issues };
}

function labManagedArtifactPaths(record: StudioRunHistoryRecord, records: readonly LabImageHistoryRecord[]): string[] {
  const paths = records
    .filter((mediaRecord) => (mediaRecord.runId || mediaRecord.id) === record.id)
    .map((mediaRecord) => mediaRecord.relativePath)
    .filter((relativePath): relativePath is string => Boolean(relativePath));
  paths.push(...studioHistoryArtifactPaths(record));
  return [...new Set(paths)]
    .sort((left, right) => left.localeCompare(right));
}

function labMediaOnlyMutationSubjects(
  runHistory: StudioRunHistory,
  records: readonly LabImageHistoryRecord[],
): StudioHistoryMutationSubject[] {
  const runOwnedIDs = new Set(Object.values(runHistory).flat().map((record) => record.id));
  const subjects = new Map<string, { capabilityId: string; artifactPaths: string[] }>();
  for (const record of records) {
    const id = record.runId || record.id;
    if (runOwnedIDs.has(id)) continue;
    const existing = subjects.get(id);
    if (existing && existing.capabilityId !== record.capabilityId) {
      throw new Error(`Lab retained media history has conflicting capability ownership: ${id}`);
    }
    const subject = existing ?? { capabilityId: record.capabilityId, artifactPaths: [] };
    if (record.relativePath) subject.artifactPaths.push(record.relativePath);
    subjects.set(id, subject);
  }
  return [...subjects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, subject]) => ({
      id,
      capabilityId: subject.capabilityId,
      artifactPaths: [...new Set(subject.artifactPaths)].sort((left, right) => left.localeCompare(right)),
    }));
}
