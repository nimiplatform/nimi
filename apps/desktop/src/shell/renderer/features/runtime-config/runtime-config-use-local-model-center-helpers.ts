import type { LocalRuntimeAssetDeclaration, LocalRuntimeAssetKind } from '@runtime/local-runtime';
import { normalizeModelTypeOption, type AssetEngineOption } from './runtime-config-model-center-utils.js';
import { ASSET_KIND_OPTIONS } from './runtime-config-local-model-center-helpers.js';

export const RUNNABLE_ASSET_KINDS = new Set(['chat', 'image', 'video', 'tts', 'stt', 'embedding']);

export function defaultEngineForModelType(modelType: string): AssetEngineOption {
  if (modelType === 'image' || modelType === 'video') {
    return 'media';
  }
  if (modelType === 'tts' || modelType === 'stt') {
    return 'speech';
  }
  if (modelType === 'music') {
    return 'sidecar';
  }
  return 'llama';
}

export function defaultEngineForDependencyAssetKind(kind: LocalRuntimeAssetKind): AssetEngineOption | '' {
  if (kind === 'auxiliary') {
    return '';
  }
  return 'media';
}

export function normalizeDependencyAssetKind(kind: string | undefined): LocalRuntimeAssetKind {
  const normalized = String(kind || '').trim().toLowerCase();
  return (ASSET_KIND_OPTIONS.find((value) => value === normalized) || 'vae') as LocalRuntimeAssetKind;
}

export function defaultEngineForAnyAssetKind(kind: string): AssetEngineOption | '' {
  if (kind === 'chat' || kind === 'embedding') return 'llama';
  if (kind === 'image' || kind === 'video') return 'media';
  if (kind === 'tts' || kind === 'stt') return 'speech';
  if (kind === 'music') return 'sidecar';
  if (kind === 'auxiliary') return '';
  return 'media';
}

export function normalizeAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclaration,
): LocalRuntimeAssetDeclaration {
  const assetKind = declaration?.assetKind;
  const isRunnable = RUNNABLE_ASSET_KINDS.has(String(assetKind || ''));
  if (!isRunnable && assetKind) {
    const normalizedKind = normalizeDependencyAssetKind(assetKind);
    const engine = String(declaration?.engine || '').trim();
    return {
      assetKind: normalizedKind,
      ...(engine ? { engine } : (normalizedKind === 'auxiliary' ? {} : { engine: defaultEngineForDependencyAssetKind(normalizedKind) })),
    };
  }

  const modelType = normalizeModelTypeOption(assetKind);
  return {
    assetKind: modelType === 'music' ? 'chat' : modelType as LocalRuntimeAssetKind,
    engine: String(declaration?.engine || '').trim() || defaultEngineForModelType(modelType),
  };
}

export function canImportDeclaration(declaration: LocalRuntimeAssetDeclaration): boolean {
  const assetKind = declaration.assetKind;
  if (!assetKind) {
    return false;
  }
  if (assetKind === 'auxiliary') {
    return Boolean(String(declaration.engine || '').trim());
  }
  return true;
}

export function capabilitiesForAssetKind(kind: LocalRuntimeAssetKind): string[] {
  switch (kind) {
    case 'image':
      return ['image'];
    case 'video':
      return ['video'];
    case 'tts':
      return ['tts'];
    case 'stt':
      return ['stt'];
    case 'embedding':
      return ['embedding'];
    default:
      return ['chat'];
  }
}

export function manifestPathFromSourceRepo(repo: string | undefined): string | undefined {
  const normalized = String(repo || '').trim();
  if (!normalized.toLowerCase().startsWith('file://')) {
    return undefined;
  }
  try {
    return decodeURIComponent(new URL(normalized).pathname);
  } catch {
    return normalized.slice('file://'.length);
  }
}
