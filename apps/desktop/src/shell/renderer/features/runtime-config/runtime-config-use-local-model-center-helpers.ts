import type { LocalRuntimeAssetDeclaration, LocalRuntimeAssetKind } from '@runtime/local-runtime';
import {
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
} from '@nimiplatform/sdk/runtime';
import { ALL_ASSET_KIND_OPTIONS, ASSET_KIND_OPTIONS } from './runtime-config-local-model-center-helpers.js';

export const RUNNABLE_ASSET_KINDS = new Set(LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS);

export function isRunnableAssetKind(kind: LocalRuntimeAssetKind): boolean {
  return isLocalRuntimeRunnableAssetKindId(kind);
}

export function normalizeDependencyAssetKind(kind: string | undefined): LocalRuntimeAssetKind {
  const normalized = String(kind || '').trim().toLowerCase();
  return (ASSET_KIND_OPTIONS.find((value) => value === normalized) || 'vae') as LocalRuntimeAssetKind;
}

export function normalizeAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclaration,
): LocalRuntimeAssetDeclaration {
  const assetKind = declaration?.assetKind;
  const engine = String(declaration?.engine || '').trim();
  if (assetKind && ALL_ASSET_KIND_OPTIONS.includes(assetKind)) {
    const normalizedKind = (ASSET_KIND_OPTIONS as readonly string[]).includes(assetKind)
      ? normalizeDependencyAssetKind(assetKind)
      : assetKind;
    return {
      assetKind: normalizedKind,
      ...(engine ? { engine } : {}),
    };
  }

  return {
    assetKind: 'chat',
    ...(engine ? { engine } : {}),
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
  return localRuntimeCapabilitiesForAssetKind(kind);
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
