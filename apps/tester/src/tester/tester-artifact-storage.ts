import { convertTauriFileSrc } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeTesterCommand } from './tester-tauri.js';
import { withTesterDataStorageRoot } from './tester-app-storage.js';

export type TesterArtifactSaveResult = {
  artifactPath: string;
  filename: string;
  byteSize: number;
  mimeType?: string;
  previewUrl: string;
};

function parseBase64DataUrl(dataUrl: string): { mimeType?: string; dataBase64: string } {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
  if (!match) {
    throw new Error('TESTER_ARTIFACT_DATA_URL_UNSUPPORTED: expected a base64 data URL');
  }
  const mimeType = match[1]?.trim() || undefined;
  const dataBase64 = match[2]?.trim() || '';
  if (!dataBase64) {
    throw new Error('TESTER_ARTIFACT_DATA_URL_EMPTY: data URL payload is empty');
  }
  return { mimeType, dataBase64 };
}

export async function saveTesterArtifact(input: {
  filename: string;
  mimeType?: string;
  dataUrl: string;
}): Promise<TesterArtifactSaveResult> {
  const parsed = parseBase64DataUrl(input.dataUrl);
  const result = await invokeTesterCommand<Omit<TesterArtifactSaveResult, 'previewUrl'>>('tester_artifact_save', {
    payload: await withTesterDataStorageRoot({
      filename: input.filename,
      mimeType: input.mimeType || parsed.mimeType,
      dataBase64: parsed.dataBase64,
    }),
  });
  return {
    ...result,
    previewUrl: convertTauriFileSrc(result.artifactPath),
  };
}
