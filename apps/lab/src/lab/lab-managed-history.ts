import type { LabImageHistoryRecord } from './lab-image-history.js';
import { projectStudioManagedHistory, type StudioRunHistory } from '../ai-studio-core/index.js';

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
  readonly clearRunHistory: (capabilityId?: string) => Promise<StudioRunHistory>;
  readonly clearImageHistory: (capabilityId?: string) => Promise<readonly LabImageHistoryRecord[]>;
};

export async function reconcileLabManagedHistoryProjection(
  runHistory: StudioRunHistory,
  imageHistory: readonly LabImageHistoryRecord[],
  statAsset: (relativePath: string) => Promise<unknown>,
): Promise<{ readonly runHistory: StudioRunHistory; readonly imageHistory: readonly LabImageHistoryRecord[] }> {
  const projection = await projectStudioManagedHistory({
    runHistory,
    existingMediaHistory: imageHistory,
    retainUnprojectedMedia: true,
    inspectArtifact: async (artifact) => {
      try {
        await statAsset(artifact.relativePath);
        return { status: 'ready' };
      } catch {
        return { status: 'unavailable' };
      }
    },
  });
  return { runHistory: projection.runHistory, imageHistory: projection.mediaHistory };
}

export async function deleteLabManagedHistoryRecord(
  port: LabManagedHistoryPort,
  runId: string,
  deleteAsset: boolean,
): Promise<LabManagedHistoryOutcome> {
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

export async function clearLabManagedHistoryScope(
  port: LabManagedHistoryPort,
  capabilityId: string | null,
  deleteAssets: boolean,
): Promise<LabManagedHistoryOutcome> {
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

async function removeManagedAssets(port: LabManagedHistoryPort, relativePaths: readonly string[]): Promise<string[]> {
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

function managedAssetPaths(runHistory: StudioRunHistory, records: readonly LabImageHistoryRecord[], runId: string): string[] {
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
  runHistory: StudioRunHistory,
  imageHistory: readonly LabImageHistoryRecord[],
  issues: readonly { readonly runId: string; readonly step: 'asset' | 'history'; readonly message: string }[],
): LabManagedHistoryOutcome {
  return Object.freeze({ completed, skipped, failed, runHistory, imageHistory, issues: Object.freeze([...issues]) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown failure');
}
