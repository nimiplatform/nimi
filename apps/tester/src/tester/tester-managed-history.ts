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

export async function deleteTesterManagedHistoryRecord(
  port: TesterManagedHistoryPort,
  runId: string,
  deleteAsset: boolean,
): Promise<TesterManagedHistoryOutcome> {
  const [storedRuns, storedMedia] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const media = storedMedia.find((record) => (record.runId || record.id) === runId);
  if (deleteAsset && media?.relativePath) {
    try {
      await port.removeAsset(media.relativePath);
    } catch (error) {
      return outcome(0, 1, 0, storedRuns, storedMedia, [{ runId, step: 'asset', message: errorMessage(error) }]);
    }
  }
  try {
    await port.removeRunHistory(runId);
    await port.removeImageHistory(runId);
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
    await port.clearRunHistory(capabilityId ?? undefined);
    await port.clearImageHistory(capabilityId ?? undefined);
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
    const media = scopedMedia.find((record) => (record.runId || record.id) === runId);
    if (media?.relativePath) {
      try {
        await port.removeAsset(media.relativePath);
      } catch (error) {
        skipped += 1;
        issues.push({ runId, step: 'asset', message: errorMessage(error) });
        continue;
      }
    }
    try {
      await port.removeRunHistory(runId);
      await port.removeImageHistory(runId);
      completed += 1;
    } catch (error) {
      failed += 1;
      issues.push({ runId, step: 'history', message: errorMessage(error) });
    }
  }
  const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  return outcome(completed, skipped, failed, runHistory, imageHistory, issues);
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
