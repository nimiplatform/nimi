export type TesterArtifactPersistenceCandidate = {
  ok: boolean;
  capabilityId: string;
  output?: {
    kind?: string;
    artifactCount?: number;
    firstArtifact?: {
      relativePath?: string;
      mediaType?: string;
      sizeBytes?: number;
      sha256?: string;
      displayName?: string;
    };
    artifacts?: ReadonlyArray<{
      relativePath?: string;
    }>;
    jobId?: string;
    jobState?: string;
  };
};

export type TesterPersistableArtifactResult = TesterArtifactPersistenceCandidate & {
  ok: true;
  output: {
    kind: 'artifacts';
    artifactCount: number;
    firstArtifact: {
      relativePath: string;
      mediaType?: string;
      sizeBytes: number;
      sha256: string;
      displayName?: string;
    };
    jobId: string;
    jobState: string;
  };
};

export function shouldPersistTesterArtifactRecord(
  result: TesterArtifactPersistenceCandidate,
): result is TesterPersistableArtifactResult {
  return Boolean(
    result.ok
    && result.capabilityId !== 'world.generate'
    && result.output?.kind === 'artifacts'
    && typeof result.output.artifactCount === 'number'
    && result.output.artifactCount > 0
    && typeof result.output.firstArtifact?.relativePath === 'string'
    && typeof result.output.firstArtifact.sizeBytes === 'number'
    && typeof result.output.firstArtifact.sha256 === 'string',
  );
}

function persistenceErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

export async function cleanupTesterManagedArtifacts(
  result: TesterArtifactPersistenceCandidate,
  removeAsset: (relativePath: string) => Promise<unknown>,
): Promise<{ failures: string[]; remainingCleanupPaths: string[] }> {
  if (!shouldPersistTesterArtifactRecord(result)) return { failures: [], remainingCleanupPaths: [] };
  const paths = [...new Set(
    (result.output.artifacts?.length ? result.output.artifacts : [result.output.firstArtifact])
      .map((artifact) => artifact.relativePath)
      .filter((relativePath): relativePath is string => Boolean(relativePath)),
  )];
  return cleanupTesterManagedArtifactPaths(paths.reverse(), removeAsset);
}

export async function cleanupTesterManagedArtifactPaths(
  relativePaths: readonly string[],
  removeAsset: (relativePath: string) => Promise<unknown>,
): Promise<{ failures: string[]; remainingCleanupPaths: string[] }> {
  const failures: string[] = [];
  const remainingCleanupPaths: string[] = [];
  for (const relativePath of [...new Set(relativePaths)]) {
    try {
      await removeAsset(relativePath);
    } catch (error) {
      failures.push(`${relativePath}: ${persistenceErrorMessage(error, 'Managed artifact removal failed.')}`);
      remainingCleanupPaths.push(relativePath);
    }
  }
  return { failures, remainingCleanupPaths };
}

export function settleTesterHistorySaveIssueAfterPersistedRun<T extends { id: string }>(
  issue: {
    message: string;
    records: readonly T[];
    cleanupPaths: readonly string[];
  },
  persistedRecordID: string,
): { message: string; records: readonly T[]; cleanupPaths: readonly string[] } | null {
  const remainingRecords = issue.records.filter((record) => record.id !== persistedRecordID);
  if (remainingRecords.length === 0 && issue.cleanupPaths.length === 0) return null;
  return { ...issue, records: remainingRecords };
}

export async function persistTesterRunHistoryWithArtifactCompensation<T>(
  result: TesterArtifactPersistenceCandidate,
  persist: () => Promise<T>,
  removeAsset: (relativePath: string) => Promise<unknown>,
): Promise<
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      managedArtifactCleanup: 'completed' | 'failed' | 'not-required';
      remainingCleanupPaths: string[];
      displayFailure?: { reason: 'runtime-call-failed'; message: string };
    }
> {
  try {
    return { ok: true, value: await persist() };
  } catch (error) {
    const persistenceMessage = persistenceErrorMessage(error, 'History persistence failed.');
    if (!shouldPersistTesterArtifactRecord(result)) {
      return {
        ok: false,
        message: persistenceMessage,
        managedArtifactCleanup: 'not-required',
        remainingCleanupPaths: [],
      };
    }
    const cleanup = await cleanupTesterManagedArtifacts(result, removeAsset);
    const message = cleanup.failures.length > 0
      ? `${persistenceMessage} Managed artifact cleanup also failed: ${cleanup.failures.join('; ')}`
      : persistenceMessage;
    return cleanup.failures.length > 0
      ? {
          ok: false,
          message,
          managedArtifactCleanup: 'failed',
          remainingCleanupPaths: cleanup.remainingCleanupPaths,
          displayFailure: { reason: 'runtime-call-failed', message },
        }
      : {
          ok: false,
          message,
          managedArtifactCleanup: 'completed',
          remainingCleanupPaths: [],
          displayFailure: { reason: 'runtime-call-failed', message },
        };
  }
}
