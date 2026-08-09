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
