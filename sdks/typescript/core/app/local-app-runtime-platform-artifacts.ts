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

export type NimiLocalAppArtifactsClient = {
  readonly putArtifact: (input: NimiLocalAppArtifactPutInput) => Promise<NimiLocalAppArtifactPutResult>;
  readonly readArtifactBytes: (input: NimiLocalAppArtifactReadInput) => Promise<NimiLocalAppArtifactBytes>;
};

export function createNimiLocalAppArtifactsClient(
  _shell: NimiLocalAppArtifactsShell,
): NimiLocalAppArtifactsClient {
  const unavailable = async (): Promise<never> => protectedAppAccessUnavailable();
  return Object.freeze({
    putArtifact: unavailable,
    readArtifactBytes: unavailable,
  });
}

function protectedAppAccessUnavailable(): never {
  return localAppError(
    'Protected App operations are unavailable until Runtime establishes a fresh App Access session.',
    'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
    'retry_after_protected_session_establishment',
  );
}
