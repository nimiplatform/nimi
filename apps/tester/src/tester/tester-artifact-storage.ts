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
    message: 'Nimi artifact materialization is not admitted by the local-app carrier. App-owned media persistence belongs in the native app host; opening a Nimi-owned artifact requires a future one-shot permission.',
    code: 'capability-unavailable',
    reasonCode: 'TESTER_LOCAL_APP_ARTIFACT_WRITE_UNAVAILABLE',
    actionHint: 'use_app_owned_media_storage_or_await_artifact_permission_admission',
    retryable: false,
    source: 'sdk',
  });
}
