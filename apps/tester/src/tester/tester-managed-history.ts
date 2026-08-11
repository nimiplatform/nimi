import type { TesterImageHistoryRecord } from './tester-image-history.js';
import type { TesterRunHistory } from './tester-history.js';

export type TesterManagedHistoryOutcome = {
  readonly completed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly runHistory: TesterRunHistory;
  readonly imageHistory: readonly TesterImageHistoryRecord[];
  readonly issues: readonly { readonly runId: string; readonly step: 'asset' | 'history'; readonly message: string }[];
};

export type TesterManagedHistoryPort = {
  readonly loadRunHistory: () => Promise<TesterRunHistory>;
  readonly loadImageHistory: () => Promise<readonly TesterImageHistoryRecord[]>;
  readonly removeAsset: (relativePath: string) => Promise<{ readonly removed: boolean }>;
  readonly removeRunHistory: (runId: string) => Promise<TesterRunHistory>;
  readonly removeImageHistory: (runId: string) => Promise<readonly TesterImageHistoryRecord[]>;
  readonly clearRunHistory: (capabilityId?: string) => Promise<TesterRunHistory>;
  readonly clearImageHistory: (capabilityId?: string) => Promise<readonly TesterImageHistoryRecord[]>;
};

export async function reconcileTesterManagedHistoryProjection(
  runHistory: TesterRunHistory,
  imageHistory: readonly TesterImageHistoryRecord[],
  statAsset: (relativePath: string) => Promise<unknown>,
): Promise<{ readonly runHistory: TesterRunHistory; readonly imageHistory: readonly TesterImageHistoryRecord[] }> {
  const storedByID = new Map(imageHistory.map((record) => [record.id, record]));
  const projected: TesterImageHistoryRecord[] = [];
  const projectedIDs = new Set<string>();
  for (const record of Object.values(runHistory).flat()) {
    if (record.result?.ok !== true || record.result.kind !== 'artifacts') continue;
    const artifacts = record.result.artifacts?.length
      ? record.result.artifacts
      : record.result.firstArtifact ? [record.result.firstArtifact] : [];
    for (const [index, artifact] of artifacts.entries()) {
      if (!artifact.relativePath) continue;
      const id = index === 0 ? record.id : `${record.id}:${index}`;
      const stored = storedByID.get(id);
      projected.push({
        ...stored,
        id,
        runId: record.id,
        kind: 'runtime-media',
        capabilityId: record.capabilityId,
        title: artifact.displayName || artifact.relativePath || record.result.jobId || record.capabilityId,
        status: 'ready',
        createdAt: record.createdAt,
        artifactCount: record.result.artifactCount,
        artifactLabel: artifact.displayName || artifact.relativePath,
        relativePath: artifact.relativePath,
        ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        jobId: record.result.jobId,
        jobState: record.result.jobState,
        message: record.message,
        traceState: record.result.traceId ? 'captured' : 'not-captured',
        ...(record.result.traceId ? { traceId: record.result.traceId } : {}),
      });
      projectedIDs.add(id);
    }
  }
  for (const stored of imageHistory) {
    if (!projectedIDs.has(stored.id)) projected.push(stored);
  }

  const availability = new Map<string, boolean>();
  await Promise.all([...new Set(projected
    .filter((record) => record.status === 'ready' && record.kind === 'runtime-media')
    .map((record) => record.relativePath)
    .filter((relativePath): relativePath is string => Boolean(relativePath)))]
    .map(async (relativePath) => {
      try {
        await statAsset(relativePath);
        availability.set(relativePath, true);
      } catch {
        availability.set(relativePath, false);
      }
    }));

  const unavailableRunIDs = new Set<string>();
  const honestImageHistory = projected.map((record) => {
    if (record.status !== 'ready' || !record.relativePath || availability.get(record.relativePath) !== false) {
      return record;
    }
    unavailableRunIDs.add(record.runId || record.id);
    return { ...record, status: 'unavailable' as const };
  });
  const honestRunHistory = Object.fromEntries(Object.entries(runHistory).map(([capabilityId, records]) => [
    capabilityId,
    records.map((record) => (
      unavailableRunIDs.has(record.id) && record.status === 'ready'
        ? { ...record, status: 'unavailable' as const }
        : record
    )),
  ]));
  return { runHistory: honestRunHistory, imageHistory: honestImageHistory };
}

export async function deleteTesterManagedHistoryRecord(
  port: TesterManagedHistoryPort,
  runId: string,
  deleteAsset: boolean,
): Promise<TesterManagedHistoryOutcome> {
  const [storedRuns, storedMedia] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const assetPaths = managedAssetPaths(storedRuns, storedMedia, runId);
  if (deleteAsset) {
    const assetFailures = await removeManagedAssets(port, assetPaths);
    if (assetFailures.length > 0) {
      return outcome(0, 1, 0, storedRuns, storedMedia, [{ runId, step: 'asset', message: assetFailures.join('; ') }]);
    }
  }
  try {
    await port.removeImageHistory(runId);
    await port.removeRunHistory(runId);
  } catch (error) {
    const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
    return outcome(0, 0, 1, runHistory, imageHistory, [{ runId, step: 'history', message: errorMessage(error) }]);
  }
  const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  return outcome(1, 0, 0, runHistory, imageHistory, []);
}

export async function clearTesterManagedHistoryScope(
  port: TesterManagedHistoryPort,
  capabilityId: string | null,
  deleteAssets: boolean,
): Promise<TesterManagedHistoryOutcome> {
  if (!deleteAssets) {
    await port.clearImageHistory(capabilityId ?? undefined);
    await port.clearRunHistory(capabilityId ?? undefined);
    const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
    return outcome(1, 0, 0, runHistory, imageHistory, []);
  }

  const [storedRuns, storedMedia] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const scopedRuns = Object.values(storedRuns).flat()
    .filter((record) => capabilityId === null || record.capabilityId === capabilityId);
  const scopedMedia = storedMedia.filter((record) => capabilityId === null || record.capabilityId === capabilityId);
  const runIds = new Set([
    ...scopedRuns.map((record) => record.id),
    ...scopedMedia.map((record) => record.runId || record.id),
  ]);
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const issues: Array<{ runId: string; step: 'asset' | 'history'; message: string }> = [];
  for (const runId of runIds) {
    const assetFailures = await removeManagedAssets(port, managedAssetPaths(storedRuns, storedMedia, runId));
    if (assetFailures.length > 0) {
      skipped += 1;
      issues.push({ runId, step: 'asset', message: assetFailures.join('; ') });
      continue;
    }
    try {
      await port.removeImageHistory(runId);
      await port.removeRunHistory(runId);
      completed += 1;
    } catch (error) {
      failed += 1;
      issues.push({ runId, step: 'history', message: errorMessage(error) });
    }
  }
  const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  return outcome(completed, skipped, failed, runHistory, imageHistory, issues);
}

async function removeManagedAssets(port: TesterManagedHistoryPort, relativePaths: readonly string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const relativePath of relativePaths) {
    try {
      await port.removeAsset(relativePath);
    } catch (error) {
      failures.push(`${relativePath}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

function managedAssetPaths(runHistory: TesterRunHistory, records: readonly TesterImageHistoryRecord[], runId: string): string[] {
  const paths = records
    .filter((record) => (record.runId || record.id) === runId)
    .map((record) => record.relativePath)
    .filter((relativePath): relativePath is string => Boolean(relativePath));
  for (const record of Object.values(runHistory).flat()) {
    if (record.id !== runId || record.result?.ok !== true || record.result.kind !== 'artifacts') continue;
    for (const artifact of record.result.artifacts ?? []) {
      if (artifact.relativePath) paths.push(artifact.relativePath);
    }
    if (record.result.firstArtifact?.relativePath) paths.push(record.result.firstArtifact.relativePath);
  }
  return [...new Set(paths)]
    .sort((left, right) => left.localeCompare(right));
}

function outcome(
  completed: number,
  skipped: number,
  failed: number,
  runHistory: TesterRunHistory,
  imageHistory: readonly TesterImageHistoryRecord[],
  issues: readonly { readonly runId: string; readonly step: 'asset' | 'history'; readonly message: string }[],
): TesterManagedHistoryOutcome {
  return Object.freeze({ completed, skipped, failed, runHistory, imageHistory, issues: Object.freeze([...issues]) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown failure');
}
