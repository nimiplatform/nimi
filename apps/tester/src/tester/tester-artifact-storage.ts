import { createNimiError } from '@nimiplatform/sdk/types';

export type TesterArtifactSaveResult = {
  artifactPath: string;
  filename: string;
  byteSize: number;
  mimeType?: string;
  previewUrl: string;
};

export async function saveTesterArtifact(_input: {
  filename: string;
  mimeType?: string;
  dataUrl: string;
}): Promise<TesterArtifactSaveResult> {
  throw createNimiError({
    message: 'Nimi artifact materialization is unavailable until Runtime establishes the common App Access ingress. App-owned media persistence remains in the native App host.',
    code: 'capability-unavailable',
    reasonCode: 'TESTER_LOCAL_APP_ARTIFACT_WRITE_UNAVAILABLE',
    actionHint: 'use_app_owned_media_storage_or_wait_for_app_access_ingress',
    retryable: false,
    source: 'sdk',
  });
}
