import { parse as parseYaml } from 'yaml';
import externalApiSurfaceYaml from '../../../../../spec/kernel/tables/external-api-surface.yaml?raw';

export type MarbleViewerQuality = 'mini' | 'standard';

type ExternalApiSurface = {
  models?: Array<Record<string, unknown>>;
};

function parseExternalApiSurface(yamlText: string): ExternalApiSurface {
  const parsed = parseYaml(yamlText) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('MARBLE_MODEL_AUTHORITY_INVALID');
  }
  return parsed as ExternalApiSurface;
}

export function resolveMarbleDefaultQualityFromAuthority(yamlText = externalApiSurfaceYaml): MarbleViewerQuality {
  const surface = parseExternalApiSurface(yamlText);
  const defaults = (surface.models ?? []).filter((model) => model['realm-drift-default'] === true);
  if (defaults.length !== 1) {
    throw new Error('MARBLE_DEFAULT_MODEL_AUTHORITY_INVALID');
  }
  const quality = String(defaults[0]?.quality ?? '');
  if (quality === 'draft') return 'mini';
  if (quality === 'standard') return 'standard';
  throw new Error('MARBLE_DEFAULT_MODEL_QUALITY_INVALID');
}

export function resolveInitialMarbleQuality(
  env: Record<string, string | boolean | undefined> | undefined = import.meta.env,
): MarbleViewerQuality {
  if (env?.VITE_MARBLE_QUALITY === 'standard') return 'standard';
  if (env?.VITE_MARBLE_QUALITY === 'mini') return 'mini';
  return resolveMarbleDefaultQualityFromAuthority();
}
