import { convertTauriFileSrc, writeShellArtifact } from '@nimiplatform/kit/shell/renderer/bridge';

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

function sanitizeArtifactFilename(filename: string): string {
  const normalized = filename
    .trim()
    .split('')
    .map((char) => (/[a-zA-Z0-9._-]/u.test(char) ? char : '-'))
    .join('');
  const collapsed = normalized.split('-').filter(Boolean).join('-');
  const trimmed = collapsed.replace(/^\.+|\.+$/gu, '').replace(/^-+|-+$/gu, '');
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return 'nimi-tester-artifact';
  }
  return trimmed.slice(0, 180);
}

export async function saveTesterArtifact(input: {
  filename: string;
  mimeType?: string;
  dataUrl: string;
}): Promise<TesterArtifactSaveResult> {
  const parsed = parseBase64DataUrl(input.dataUrl);
  const filename = sanitizeArtifactFilename(input.filename);
  const result = await writeShellArtifact({
    relativePath: `artifacts/${filename}`,
    mimeType: input.mimeType || parsed.mimeType,
    dataBase64: parsed.dataBase64,
  });
  return {
    artifactPath: result.path,
    filename,
    byteSize: result.byteSize,
    mimeType: result.mimeType || input.mimeType || parsed.mimeType,
    previewUrl: convertTauriFileSrc(result.path),
  };
}
