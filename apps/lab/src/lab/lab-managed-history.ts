import type { LabImageHistoryRecord } from './lab-image-history.js';
import {
  clearStudioHistoryWithPolicy,
  projectStudioManagedHistory,
  removeStudioHistoryWithPolicy,
  studioHistoryArtifactPaths,
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
  readonly clearRunHistory: (capabilityId?: string) => Promise<StudioRunHistory>;
  readonly clearImageHistory: (capabilityId?: string) => Promise<readonly LabImageHistoryRecord[]>;
};

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
  const [storedRuns, storedMedia] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const policyOutcome = await removeStudioHistoryWithPolicy({
    history: storedRuns,
    recordId: runId,
    deleteAssets: deleteAsset,
    removeArtifact: port.removeAsset,
    resolveArtifactPaths: (record) => labManagedArtifactPaths(record, storedMedia),
    commit: async (_next, removed) => {
      for (const record of removed) {
        await port.removeImageHistory(record.id);
        await port.removeRunHistory(record.id);
      }
    },
    project: async () => {
      const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
      return { runHistory, imageHistory };
    },
  });
  return labManagedHistoryOutcome(policyOutcome);
}

export async function clearLabManagedHistoryScope(
  port: LabManagedHistoryPort,
  capabilityId: string | null,
  deleteAssets: boolean,
): Promise<LabManagedHistoryOutcome> {
  const [storedRuns, storedMedia] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
  const policyOutcome = await clearStudioHistoryWithPolicy({
    history: storedRuns,
    capabilityId,
    deleteAssets,
    removeArtifact: port.removeAsset,
    resolveArtifactPaths: (record) => labManagedArtifactPaths(record, storedMedia),
    commit: async (_next, removed) => {
      if (!deleteAssets) {
        await port.clearImageHistory(capabilityId ?? undefined);
        await port.clearRunHistory(capabilityId ?? undefined);
        return;
      }
      for (const record of removed) {
        await port.removeImageHistory(record.id);
        await port.removeRunHistory(record.id);
      }
    },
    project: async () => {
      const [runHistory, imageHistory] = await Promise.all([port.loadRunHistory(), port.loadImageHistory()]);
      return { runHistory, imageHistory };
    },
  });
  return labManagedHistoryOutcome(policyOutcome);
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

function labManagedHistoryOutcome(
  policyOutcome: {
    readonly completed: number;
    readonly skipped: number;
    readonly failed: number;
    readonly projection: {
      readonly runHistory: StudioRunHistory;
      readonly imageHistory: readonly LabImageHistoryRecord[];
    };
    readonly issues: readonly { readonly runId: string; readonly step: 'asset' | 'history'; readonly message: string }[];
  },
): LabManagedHistoryOutcome {
  return Object.freeze({
    completed: policyOutcome.completed,
    skipped: policyOutcome.skipped,
    failed: policyOutcome.failed,
    runHistory: policyOutcome.projection.runHistory,
    imageHistory: policyOutcome.projection.imageHistory,
    issues: Object.freeze([...policyOutcome.issues]),
  });
}
