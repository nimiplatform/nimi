import { studioWorldInputSource as worldSource } from '../../ai-studio-core/managed-result-references.js';
import { t } from '../../shell/i18n/index.js';
import type { StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import { defineStudioParameters } from '../../ai-studio-core/parameters.js';
import type { StudioParameterValue } from '../../ai-studio-core/parameters.js';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';

export type WorldInputMode = 'text' | 'ordinary' | 'equirectangular-360';

export const worldTourParameters = defineStudioParameters({
  initial: () => ({ inputMode: 'text' as WorldInputMode }),
  routeMatrix: {},
  hasAlternativeInput: (p: StudioParameterValue) => p.inputMode !== 'text' && Boolean(worldSource(p)),
  restoreRecordedParameters: (p: StudioParameterValue | undefined) => {
    if (!p) return null;
    if (Object.keys(p).length === 0) return { inputMode: 'text' };
    if (p.inputMode === 'text') return { ...p };
    return worldSource(p) ? { ...p } : null;
  },
});

export { studioWorldInputSource as worldSource } from '../../ai-studio-core/managed-result-references.js';

export async function readWorldInput(source: StudioManagedArtifact) {
  const read = await getLabLocalAppClient().storage.assets.read({ relativePath: source.relativePath });
  if (read.asset.sizeBytes !== source.sizeBytes || read.asset.sha256 !== source.sha256 || read.asset.mediaType !== source.mediaType) throw new Error(t('WorldTour.sourceUnavailable'));
  const bytes = new Uint8Array(source.sizeBytes);
  let offset = 0;
  for await (const chunk of read.body) { bytes.set(chunk, offset); offset += chunk.length; }
  if (offset !== source.sizeBytes) throw new Error(t('WorldTour.sourceUnavailable'));
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
  if (`sha256:${sha}` !== source.sha256) throw new Error(t('WorldTour.sourceUnavailable'));
  return bytes;
}
