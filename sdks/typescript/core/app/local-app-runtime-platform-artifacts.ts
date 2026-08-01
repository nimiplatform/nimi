import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  localAppError,
  localAppProjectionError,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation.js';

const MAX_ARTIFACT_DATA_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_DISPLAY_NAME_BYTES = 512;
const MAX_ARTIFACT_READ_BYTES = 32 * 1024 * 1024;

export type NimiLocalAppArtifactPutInput = {
  readonly mimeType: string;
  readonly displayName: string;
  readonly data: Uint8Array;
};

export type NimiLocalAppArtifactPutResult = {
  readonly artifactId: string;
};

export type NimiLocalAppArtifactReadInput = {
  readonly artifactId: string;
};

export type NimiLocalAppArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type NimiLocalAppArtifactsShell = {
  readonly put: (input: {
    readonly mimeType: string;
    readonly displayName: string;
    readonly data: Uint8Array;
  }) => Promise<unknown>;
  readonly readBytes: (input: {
    readonly artifactId: string;
  }) => Promise<unknown>;
};

export type NimiLocalAppArtifactsClient = ReturnType<typeof createNimiLocalAppArtifactsClient>;

export function createNimiLocalAppArtifactsClient(shell: NimiLocalAppArtifactsShell) {
  return Object.freeze({
    putArtifact: async (input: NimiLocalAppArtifactPutInput): Promise<NimiLocalAppArtifactPutResult> => {
      assertExactKeys(input, ['mimeType', 'displayName', 'data'], 'local-app artifact put input');
      assertNoAuthorityMaterial(input);
      const mimeType = requireText(input.mimeType, 'mimeType');
      if (typeof input.displayName !== 'string'
        || input.displayName.trim() !== input.displayName
        || new TextEncoder().encode(input.displayName).byteLength > MAX_ARTIFACT_DISPLAY_NAME_BYTES) {
        return localAppError(
          'Local-app artifact displayName is invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_artifact_display_name',
        );
      }
      if (!(input.data instanceof Uint8Array)
        || input.data.byteLength === 0
        || input.data.byteLength > MAX_ARTIFACT_DATA_BYTES) {
        return localAppError(
          'Local-app artifact data must be 1 to 4194304 bytes.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_artifact_data_within_bound',
        );
      }
      const value = await shell.put({
        mimeType,
        displayName: input.displayName,
        data: input.data,
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['artifactId'], 'artifact put');
      return Object.freeze({ artifactId: projectionText(record.artifactId, 'artifactId') });
    },
    readArtifactBytes: async (input: NimiLocalAppArtifactReadInput): Promise<NimiLocalAppArtifactBytes> => {
      assertExactKeys(input, ['artifactId'], 'local-app artifact read input');
      assertNoAuthorityMaterial(input);
      const artifactId = requireText(input.artifactId, 'artifactId');
      const value = await shell.readBytes({ artifactId });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['bytes', 'mimeType'], 'artifact read bytes');
      if (!(record.bytes instanceof Uint8Array)
        || record.bytes.byteLength === 0
        || record.bytes.byteLength > MAX_ARTIFACT_READ_BYTES) {
        return localAppProjectionError('artifact bytes');
      }
      return Object.freeze({
        bytes: record.bytes,
        mimeType: projectionText(record.mimeType, 'mimeType'),
      });
    },
  });
}
