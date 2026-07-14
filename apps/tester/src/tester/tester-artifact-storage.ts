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
    message: 'Artifact materialization is not admitted by the 0K local-app carrier; only protected Runtime artifact readback is available.',
    code: 'capability-unavailable',
    reasonCode: 'TESTER_LOCAL_APP_ARTIFACT_WRITE_UNAVAILABLE',
    actionHint: 'use_runtime_artifact_read_or_await_artifact_write_admission',
    retryable: false,
    source: 'sdk',
  });
}
